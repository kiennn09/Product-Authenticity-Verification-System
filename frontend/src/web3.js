// Cấu hình mạng + kết nối MetaMask + giải mã lỗi smart contract
import { ethers } from "ethers";

const deployments = import.meta.glob("./contract.*.json", { eager: true });
export const NETWORK = import.meta.env.VITE_NETWORK || "localhost";
const found = deployments[`./contract.${NETWORK}.json`];
if (!found) throw new Error(`Thiếu file src/contract.${NETWORK}.json — hãy deploy contract trước.`);
export const CONTRACT = found.default || found;

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

export const CHAINS = {
  31337: { name: "Hardhat Localhost", explorer: null, rpc: "http://127.0.0.1:8545" },
  11155111: { name: "Ethereum Sepolia", explorer: "https://eth-sepolia.blockscout.com", rpc: "https://ethereum-sepolia-rpc.publicnode.com" },
};
export const CHAIN = CHAINS[CONTRACT.chainId] || { name: `Chain ${CONTRACT.chainId}`, explorer: null };

export const txLink = (hash) => (CHAIN.explorer ? `${CHAIN.explorer}/tx/${hash}` : null);
export const addrLink = (addr) => (CHAIN.explorer ? `${CHAIN.explorer}/address/${addr}` : null);
export const short = (s, a = 6, b = 4) => (s ? `${s.slice(0, a)}…${s.slice(-b)}` : "");
export const fmtTime = (t) => (t ? new Date(Number(t) * 1000).toLocaleString("vi-VN") : "—");

const ERROR_MESSAGES = {
  NotOwner: "Chỉ Admin (owner của contract) mới được thực hiện thao tác này.",
  NotAuthorizedManufacturer: "Tài khoản này chưa được Admin cấp quyền nhà sản xuất (hoặc đã bị vô hiệu hoá).",
  NotProductManufacturer: "Bạn không phải nhà sản xuất của sản phẩm này.",
  ContractPaused: "Hệ thống đang tạm dừng khẩn cấp.",
  ZeroAddress: "Địa chỉ ví không hợp lệ.",
  EmptyValue: "Vui lòng nhập đầy đủ thông tin bắt buộc.",
  ManufacturerAlreadyExists: "Nhà sản xuất này đã tồn tại.",
  ManufacturerNotFound: "Không tìm thấy nhà sản xuất.",
  ProductAlreadyRegistered: "Mã sản phẩm này đã được đăng ký trước đó.",
  ProductNotFound: "Không tìm thấy sản phẩm.",
  ProductAlreadyRevoked: "Sản phẩm đã bị thu hồi trước đó.",
};

const iface = new ethers.Interface(CONTRACT.abi);

export function decodeError(e) {
  if (e?.code === "ACTION_REJECTED" || e?.info?.error?.code === 4001) return "Bạn đã từ chối giao dịch trong MetaMask.";
  let name = e?.revert?.name;
  const data = e?.data || e?.info?.error?.data?.data || e?.info?.error?.data || e?.error?.data;
  if (!name && typeof data === "string" && data.startsWith("0x")) {
    try { name = iface.parseError(data)?.name; } catch { /* ignore */ }
  }
  if (name && ERROR_MESSAGES[name]) return `${ERROR_MESSAGES[name]} (${name})`;
  return e?.shortMessage || e?.reason || e?.message || String(e);
}

export async function connectWallet() {
  if (!window.ethereum) throw new Error("Không tìm thấy MetaMask. Hãy cài tiện ích MetaMask cho trình duyệt.");
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== CONTRACT.chainId) {
    const hex = "0x" + CONTRACT.chainId.toString(16);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (err) {
      if (err.code === 4902 && CHAIN.rpc) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: hex, chainName: CHAIN.name, rpcUrls: [CHAIN.rpc], nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 } }],
        });
      } else throw err;
    }
    return connectWallet();
  }
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const contract = new ethers.Contract(CONTRACT.address, CONTRACT.abi, signer);
  const [owner, m] = await Promise.all([contract.owner(), contract.getManufacturer(address)]);
  let role = "customer";
  if (owner.toLowerCase() === address.toLowerCase()) role = "admin";
  else if (m.isActive) role = "manufacturer";
  const balance = ethers.formatEther(await provider.getBalance(address));
  return { provider, signer, address, contract, role, balance, manufacturerName: m.name };
}

// Chờ giao dịch được xác nhận bằng RPC công khai (không phụ thuộc MetaMask),
// tối đa 120 giây. Nếu quá thời gian vẫn tiếp tục để giao diện không bị treo.
const readProvider = CHAIN.rpc ? new ethers.JsonRpcProvider(CHAIN.rpc, CONTRACT.chainId, { staticNetwork: true }) : null;
export async function waitTx(tx) {
  const hash = tx.hash || tx;
  try {
    if (readProvider) {
      const r = await readProvider.waitForTransaction(hash, 1, 120000);
      if (r && r.status === 0) throw new Error("Giao dịch thất bại (reverted)");
      return r;
    }
    return await tx.wait();
  } catch (e) {
    if (String(e?.message).includes("reverted")) throw e;
    console.warn("waitTx:", e?.message);
    return null;
  }
}

export async function api(path, options) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

export const verifyUrl = (code) => `${window.location.origin}/?code=${encodeURIComponent(code)}`;
