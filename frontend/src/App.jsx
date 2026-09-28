import { useEffect, useState, useCallback } from "react";
import { connectWallet, CHAIN, CONTRACT, short, addrLink, api, decodeError, BACKEND_URL } from "./web3";
import VerifyPage from "./pages/VerifyPage";
import ManufacturerPage from "./pages/ManufacturerPage";
import AdminPage from "./pages/AdminPage";
import EventsPage from "./pages/EventsPage";

const ROLE_LABEL = { admin: "Admin", manufacturer: "Nhà sản xuất", customer: "Khách hàng" };
const TABS = [
  { id: "verify", label: "Xác thực sản phẩm" },
  { id: "manufacturer", label: "Nhà sản xuất" },
  { id: "admin", label: "Quản trị" },
  { id: "events", label: "Sự kiện blockchain" },
];

export default function App() {
  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get("tab") || "verify");
  const [wallet, setWallet] = useState(null);
  const [stats, setStats] = useState(null);
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((text, type = "info") => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const refreshStats = useCallback(() => api("/api/stats").then(setStats).catch(() => {}), []);

  const connect = useCallback(async (silent = false) => {
    try {
      const w = await connectWallet();
      setWallet(w);
      if (silent !== true) toast(`Đã kết nối ví ${short(w.address)} — vai trò: ${ROLE_LABEL[w.role]}`, "success");
    } catch (e) {
      toast(decodeError(e), "error");
    }
  }, [toast]);

  useEffect(() => {
    refreshStats();
    const timer = setInterval(refreshStats, 4000);
    if (!window.ethereum) return () => clearInterval(timer);
    window.ethereum.request({ method: "eth_accounts" }).then((a) => a.length && connect(true));
    const onChange = () => connect();
    window.ethereum.on?.("accountsChanged", onChange);
    window.ethereum.on?.("chainChanged", onChange);
    return () => {
      clearInterval(timer);
      window.ethereum.removeListener?.("accountsChanged", onChange);
      window.ethereum.removeListener?.("chainChanged", onChange);
    };
  }, [connect, refreshStats]);

  // Nhận event real-time từ backend (Server-Sent Events) để hiện thông báo
  useEffect(() => {
    const es = new EventSource(`${BACKEND_URL}/api/events/stream`);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.event === "connected") return;
      refreshStats();
      const a = ev.args;
      const text = {
        ProductRegistered: `Sản phẩm mới được đăng ký: ${a.productCode}`,
        ProductVerified: `Sản phẩm ${a.productCode} vừa được xác thực — ${a.authentic ? "CHÍNH HÃNG" : "KHÔNG HỢP LỆ"}`,
        ProductRevoked: `Sản phẩm ${a.productCode} đã bị thu hồi`,
        ManufacturerAdded: `Nhà sản xuất mới: ${a.name}`,
        ManufacturerStatusChanged: `Trạng thái nhà sản xuất ${short(a.manufacturer)} thay đổi`,
        Paused: a.isPaused ? "Hệ thống tạm dừng" : "Hệ thống hoạt động lại",
      }[ev.event];
      if (text) toast(`🔔 ${ev.event}: ${text}`, "event");
    };
    return () => es.close();
  }, [toast, refreshStats]);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="logo">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
              <path d="M8.5 12l2.5 2.5L16 9.5" />
            </svg>
          </div>
          <div>
            <div className="brand-title">AuthentiChain</div>
            <div className="brand-sub">Hệ thống xác thực hàng chính hãng trên Blockchain</div>
          </div>
        </div>
        <div className="header-right">
          <span className="chip net">
            <span className="dot" /> {CHAIN.name}
          </span>
          {wallet ? (
            <div className="wallet">
              <span className={`chip role role-${wallet.role}`}>{ROLE_LABEL[wallet.role]}</span>
              <span className="mono">{short(wallet.address)}</span>
              <span className="muted">{Number(wallet.balance).toFixed(4)} ETH</span>
            </div>
          ) : (
            <button className="btn primary" onClick={() => connect()}>
              Kết nối MetaMask
            </button>
          )}
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {stats && (
        <section className="stats">
          <div className="stat"><b>{stats.totalProducts}</b><span>Sản phẩm đã đăng ký</span></div>
          <div className="stat"><b>{stats.totalManufacturers}</b><span>Nhà sản xuất</span></div>
          <div className="stat"><b>{stats.totalVerifications}</b><span>Lượt xác thực</span></div>
          <div className="stat warn"><b>{stats.failedVerifications}</b><span>Lượt xác thực thất bại</span></div>
        </section>
      )}

      <main>
        {tab === "verify" && <VerifyPage wallet={wallet} toast={toast} />}
        {tab === "manufacturer" && <ManufacturerPage wallet={wallet} connect={connect} toast={toast} />}
        {tab === "admin" && <AdminPage wallet={wallet} connect={connect} toast={toast} />}
        {tab === "events" && <EventsPage />}
      </main>

      <footer className="footer">
        Smart contract:{" "}
        {addrLink(CONTRACT.address) ? (
          <a href={addrLink(CONTRACT.address)} target="_blank" rel="noreferrer" className="mono">{CONTRACT.address}</a>
        ) : (
          <span className="mono">{CONTRACT.address}</span>
        )}{" "}
        · Chain ID {CONTRACT.chainId}
      </footer>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
