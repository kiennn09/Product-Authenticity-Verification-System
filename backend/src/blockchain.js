// Kết nối blockchain: provider, contract (read-only) và ví relayer (ghi giao dịch)
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const NETWORK = process.env.NETWORK || "localhost";
const infoPath = path.join(__dirname, `contract.${NETWORK}.json`);
if (!fs.existsSync(infoPath)) {
  throw new Error(`Không tìm thấy ${infoPath}. Hãy deploy contract trước (npx hardhat run scripts/deploy.js --network ${NETWORK}).`);
}
const contractInfo = JSON.parse(fs.readFileSync(infoPath, "utf8"));

// Danh sách RPC Sepolia công khai: nếu một nút lỗi (ECONNRESET, timeout)
// FallbackProvider tự chuyển sang nút khác.
const SEPOLIA_RPCS = [
  process.env.RPC_URL,
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://sepolia.drpc.org",
  "https://1rpc.io/sepolia",
  "https://eth-sepolia.public.blastapi.io",
  "https://sepolia.gateway.tenderly.co",
].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

const RPC_URL = NETWORK === "localhost" ? process.env.RPC_URL || "http://127.0.0.1:8545" : SEPOLIA_RPCS.join(", ");

// Provider tự chuyển sang RPC khác khi nút hiện tại lỗi mạng (ECONNRESET, timeout, 5xx)
class MultiRpcProvider extends ethers.JsonRpcProvider {
  constructor(urls, network) {
    super(urls[0], network, { staticNetwork: network, batchMaxCount: 1, polling: true, pollingInterval: 4000 });
    this.urls = urls;
    this.idx = 0;
  }
  async _send(payload) {
    let lastErr;
    for (let i = 0; i < this.urls.length; i++) {
      const k = (this.idx + i) % this.urls.length;
      try {
        const req = new ethers.FetchRequest(this.urls[k]);
        req.body = JSON.stringify(payload);
        req.setHeader("content-type", "application/json");
        req.timeout = 12000;
        const resp = await req.send();
        resp.assertOk();
        const body = resp.bodyJson;
        this.idx = k;
        return Array.isArray(body) ? body : [body];
      } catch (e) {
        lastErr = e;
        console.warn(`[RPC] ${this.urls[k]} lỗi: ${e.shortMessage || e.code || e.message} → thử RPC khác`);
      }
    }
    throw lastErr;
  }
}

const provider =
  NETWORK === "localhost"
    ? new ethers.JsonRpcProvider(RPC_URL, undefined, { polling: true, pollingInterval: 4000 })
    : new MultiRpcProvider(SEPOLIA_RPCS, ethers.Network.from(11155111));

// Contract chỉ đọc (view + lắng nghe event)
const readContract = new ethers.Contract(contractInfo.address, contractInfo.abi, provider);

// Ví relayer: backend thay mặt khách hàng gửi giao dịch verifyProduct,
// nhờ vậy khách hàng không cần ví MetaMask vẫn được ghi lịch sử xác thực.
let relayer = null;
let writeContract = null;
if (process.env.RELAYER_PRIVATE_KEY) {
  relayer = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
  // NonceManager tự quản lý nonce để gửi nhiều giao dịch liên tiếp không bị trùng
  writeContract = readContract.connect(new ethers.NonceManager(relayer));
}

const STATUS = ["NotRegistered", "Active", "Revoked"];

function formatProduct(p, manufacturerName) {
  return {
    productCode: p.productCode,
    name: p.name,
    batchNumber: p.batchNumber,
    description: p.description,
    manufacturer: p.manufacturer,
    manufacturerName,
    registeredAt: Number(p.registeredAt),
    status: STATUS[Number(p.status)],
    verificationCount: Number(p.verificationCount),
  };
}

module.exports = { NETWORK, RPC_URL, contractInfo, provider, readContract, writeContract, relayer, formatProduct, ethers };
