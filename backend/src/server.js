require("dotenv").config();
const express = require("express");
const cors = require("cors");
const QRCode = require("qrcode");
const { NETWORK, RPC_URL, contractInfo, provider, readContract, writeContract, relayer, formatProduct, ethers } =
  require("./blockchain");
const eventService = require("./eventService");

const app = express();
app.use(cors());
app.use(express.json());

// Không để backend bị tắt khi RPC công khai lỗi tạm thời
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e?.shortMessage || e?.message || e));
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e?.shortMessage || e?.message || e));
// Bọc mọi route async: lỗi được trả về JSON 500 thay vì làm sập server
for (const m of ["get", "post"]) {
  const orig = app[m].bind(app);
  app[m] = (route, ...handlers) =>
    orig(route, ...handlers.map((h) => (req, res, next) => {
      Promise.resolve(h(req, res, next)).catch((e) => {
        console.error("[API ERROR]", req.originalUrl, e?.shortMessage || e?.message);
        if (!res.headersSent) res.status(500).json({ error: e?.shortMessage || e?.message });
      });
    }));
}

// Ghi log mọi request (phục vụ kiểm thử / báo cáo)
app.use((req, _res, next) => {
  console.log(`[API] ${req.method} ${req.originalUrl}`);
  next();
});

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const MAX_CODE_LEN = 64;

// Hàng đợi: các giao dịch của relayer được gửi tuần tự
let txQueue = Promise.resolve();
function enqueue(fn) {
  const run = txQueue.then(fn, fn);
  txQueue = run.catch(() => {});
  return run;
}

function validateCode(code) {
  if (!code || typeof code !== "string") return "Thiếu mã sản phẩm";
  if (code.length > MAX_CODE_LEN) return "Mã sản phẩm quá dài";
  if (!/^[\w\-.]+$/.test(code)) return "Mã sản phẩm chỉ gồm chữ, số, dấu - _ .";
  return null;
}

// Thử lại khi RPC công khai lỗi mạng tạm thời (ECONNRESET, timeout...)
async function retry(fn, times = 4, delay = 1500) {
  let last;
  for (let i = 0; i < times; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const msg = String(e?.shortMessage || e?.message || e);
      if (/revert|NotAuthorized|NotOwner|Paused|insufficient/i.test(msg)) throw e;
      console.warn(`[RETRY ${i + 1}/${times}]`, msg);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw last;
}

async function readProduct(code) {
  const [authentic, p, manufacturerName] = await retry(() => readContract.checkProduct(code));
  const registered = Number(p.status) !== 0;
  return { authentic, registered, product: registered ? formatProduct(p, manufacturerName) : null };
}

// ---------------- API ----------------

// Thông tin hệ thống
app.get("/api/health", async (_req, res) => {
  const block = await provider.getBlockNumber();
  res.json({
    status: "ok",
    network: NETWORK,
    chainId: contractInfo.chainId,
    contract: contractInfo.address,
    latestBlock: block,
    relayer: relayer ? relayer.address : null,
  });
});

// Thống kê tổng quan
app.get("/api/stats", async (_req, res) => {
  const [products, total, failed, manufacturers] = await Promise.all([
    readContract.getProductCount(),
    readContract.totalVerifications(),
    readContract.totalFailedVerifications(),
    readContract.getAllManufacturers(),
  ]);
  res.json({
    totalProducts: Number(products),
    totalVerifications: Number(total),
    failedVerifications: Number(failed),
    totalManufacturers: manufacturers.length,
  });
});

// Tra cứu nhanh (chỉ đọc, không ghi lên blockchain, không tốn gas)
app.get("/api/products/:code", async (req, res) => {
  const err = validateCode(req.params.code);
  if (err) return res.status(400).json({ error: err });
  res.json(await readProduct(req.params.code));
});

// Xác thực sản phẩm: backend (relayer) gửi giao dịch verifyProduct để ghi lịch sử lên blockchain
app.post("/api/verify", async (req, res) => {
  const code = (req.body.code || "").trim();
  const err = validateCode(code);
  if (err) return res.status(400).json({ error: err });

  try {
    let tx = null;
    if (writeContract) {
      tx = await enqueue(async () => {
        const sent = await retry(() => writeContract.verifyProduct(code));
        const receipt = await retry(() => provider.waitForTransaction(sent.hash, 1, 120000));
        console.log(`[VERIFY] ${code} → tx ${sent.hash} (block ${receipt?.blockNumber})`);
        return sent;
      });
    }
    const result = await readProduct(code);
    const history = await retry(() => readContract.getVerificationHistory(code));
    res.json({
      ...result,
      recordedOnChain: Boolean(tx),
      txHash: tx ? tx.hash : null,
      verificationHistory: history.map((h) => ({
        verifier: h.verifier,
        timestamp: Number(h.timestamp),
        authentic: h.authentic,
      })),
    });
  } catch (e) {
    console.error("[VERIFY] lỗi:", e.shortMessage || e.message);
    res.status(500).json({ error: e.shortMessage || e.message });
  }
});

// Lịch sử xác thực của 1 sản phẩm (đọc từ smart contract)
app.get("/api/products/:code/history", async (req, res) => {
  const history = await readContract.getVerificationHistory(req.params.code);
  res.json(history.map((h) => ({ verifier: h.verifier, timestamp: Number(h.timestamp), authentic: h.authentic })));
});

// Danh sách sản phẩm (có thể lọc theo nhà sản xuất)
app.get("/api/products", async (req, res) => {
  const count = Number(await readContract.getProductCount());
  const items = [];
  for (let i = count - 1; i >= 0 && items.length < 200; i--) {
    const p = await readContract.getProductByIndex(i);
    if (req.query.manufacturer && p.manufacturer.toLowerCase() !== req.query.manufacturer.toLowerCase()) continue;
    items.push(formatProduct(p));
  }
  res.json(items);
});

// Danh sách nhà sản xuất
app.get("/api/manufacturers", async (_req, res) => {
  const addrs = await readContract.getAllManufacturers();
  const list = await Promise.all(
    addrs.map(async (a) => {
      const m = await readContract.getManufacturer(a);
      return { address: a, name: m.name, isActive: m.isActive, registeredAt: Number(m.registeredAt), productCount: Number(m.productCount) };
    })
  );
  res.json(list);
});

// Mã QR của sản phẩm (trỏ tới trang xác thực)
app.get("/api/qrcode/:code", async (req, res) => {
  const err = validateCode(req.params.code);
  if (err) return res.status(400).json({ error: err });
  const url = `${FRONTEND_URL}/?code=${encodeURIComponent(req.params.code)}`;
  res.type("png").send(await QRCode.toBuffer(url, { width: 320, margin: 2 }));
});

// Event: lịch sử + real-time
app.get("/api/events", (req, res) => {
  res.json(eventService.getEvents({ type: req.query.type, code: req.query.code, limit: Number(req.query.limit) || 100 }));
});

// Server-Sent Events: đẩy event mới về frontend ngay khi xảy ra
app.get("/api/events/stream", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ event: "connected" })}\n\n`);
  eventService.subscribe(res);
});

// ---------------- Khởi động ----------------
const PORT = process.env.PORT || 4000;

(async () => {
  // Thử tải lịch sử event tối đa 3 lần; nếu RPC lỗi vẫn khởi động server
  for (let i = 1; i <= 3; i++) {
    try { await eventService.loadHistory(); break; }
    catch (e) { console.error(`[HISTORY] Lỗi lần ${i}:`, e?.shortMessage || e?.message); await new Promise((r) => setTimeout(r, 3000)); }
  }
  try { eventService.startListeners(); } catch (e) { console.error("[LISTENER] lỗi:", e?.message); }
  app.listen(PORT, () => {
    console.log("==============================================");
    console.log(" Product Authenticity Backend");
    console.log(`  Network : ${NETWORK} (${RPC_URL})`);
    console.log(`  Contract: ${contractInfo.address}`);
    console.log(`  Relayer : ${relayer ? relayer.address : "(không có - chỉ đọc)"}`);
    console.log(`  API     : http://localhost:${PORT}/api`);
    console.log("==============================================");
  });
})().catch((e) => console.error("[STARTUP]", e?.message || e));

module.exports = { ethers };
