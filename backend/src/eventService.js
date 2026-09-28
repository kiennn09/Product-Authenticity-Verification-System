// Lắng nghe event của smart contract theo thời gian thực
// và truy xuất lại các event đã xảy ra trong quá khứ (historical events).
const { readContract, provider, contractInfo } = require("./blockchain");

const EVENT_NAMES = [
  "ManufacturerAdded",
  "ManufacturerStatusChanged",
  "ProductRegistered",
  "ProductRevoked",
  "ProductVerified",
  "Paused",
];

const events = [];           // bộ nhớ đệm các event (mới nhất ở cuối)
const seen = new Set();      // chống trùng lặp: txHash-logIndex
const subscribers = new Set(); // các client SSE đang kết nối
let lastSyncedBlock = null;

function serialize(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  return value;
}

function toRecord(log, blockTimestamp) {
  const fragment = log.fragment;
  const args = {};
  fragment.inputs.forEach((input, i) => (args[input.name] = serialize(log.args[i])));
  return {
    event: fragment.name,
    args,
    blockNumber: log.blockNumber,
    txHash: log.transactionHash,
    logIndex: log.index,
    timestamp: Number(args.timestamp || blockTimestamp || 0),
  };
}

function addEvent(record, { live }) {
  const id = `${record.txHash}-${record.logIndex}`;
  if (seen.has(id)) return;
  seen.add(id);
  record.id = id;
  record.source = live ? "realtime" : "history";
  events.push(record);
  events.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  if (live) {
    console.log(`[EVENT] ${record.event} @ block ${record.blockNumber}`, record.args);
    const payload = `data: ${JSON.stringify(record)}\n\n`;
    for (const res of subscribers) res.write(payload);
  }
}

/** Truy xuất lịch sử event từ block deploy tới block hiện tại (chia nhỏ theo đoạn). */
async function loadHistory() {
  const latest = await provider.getBlockNumber();
  const from = contractInfo.deployBlock || 0;
  const STEP = 9000;
  let count = 0;
  for (let start = from; start <= latest; start += STEP + 1) {
    const end = Math.min(start + STEP, latest);
    const logs = await readContract.queryFilter("*", start, end);
    for (const log of logs) {
      if (!log.fragment || !EVENT_NAMES.includes(log.fragment.name)) continue;
      addEvent(toRecord(log), { live: false });
      count++;
    }
  }
  lastSyncedBlock = latest;
  console.log(`[HISTORY] Đã tải ${count} event lịch sử (block ${from} → ${latest})`);
}

/** Đăng ký lắng nghe real-time cho từng loại event. */
function startListeners() {
  for (const name of EVENT_NAMES) {
    readContract.on(name, (...params) => {
      const payload = params[params.length - 1]; // ContractEventPayload
      addEvent(toRecord(payload.log), { live: true });
    });
  }
  console.log(`[LISTENER] Đang lắng nghe real-time: ${EVENT_NAMES.join(", ")}`);
}

function getEvents({ type, code, limit = 100 } = {}) {
  let list = events;
  if (type) list = list.filter((e) => e.event === type);
  if (code) list = list.filter((e) => e.args.productCode === code);
  return list.slice(-limit).reverse();
}

function subscribe(res) {
  subscribers.add(res);
  res.on("close", () => subscribers.delete(res));
}

module.exports = { loadHistory, startListeners, getEvents, subscribe, EVENT_NAMES, getLastSyncedBlock: () => lastSyncedBlock };
