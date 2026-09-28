import { useEffect, useState } from "react";
import { api, BACKEND_URL, fmtTime, short, txLink } from "../web3";

const TYPES = ["", "ProductRegistered", "ProductVerified", "ProductRevoked", "ManufacturerAdded", "ManufacturerStatusChanged", "Paused"];

function describe(ev) {
  const a = ev.args;
  switch (ev.event) {
    case "ProductRegistered": return `${a.productCode} — ${a.name} (lô ${a.batchNumber}) bởi ${short(a.manufacturer)}`;
    case "ProductVerified": return `${a.productCode} — ${a.authentic === true || a.authentic === "true" ? "Hợp lệ" : "Không hợp lệ"}, lần thứ ${a.verificationCount}, bởi ${short(a.verifier)}`;
    case "ProductRevoked": return `${a.productCode} — lý do: ${a.reason}`;
    case "ManufacturerAdded": return `${a.name} (${short(a.manufacturer)})`;
    case "ManufacturerStatusChanged": return `${short(a.manufacturer)} → ${a.isActive ? "kích hoạt" : "vô hiệu hoá"}`;
    case "Paused": return a.isPaused ? "Tạm dừng" : "Hoạt động lại";
    default: return JSON.stringify(a);
  }
}

export default function EventsPage() {
  const [events, setEvents] = useState([]);
  const [type, setType] = useState("");
  const [live, setLive] = useState(false);

  // 1) Tải lịch sử event (historical occurrences) từ backend
  useEffect(() => {
    api(`/api/events?limit=200${type ? `&type=${type}` : ""}`).then(setEvents);
  }, [type]);

  // 2) Nhận event mới theo thời gian thực qua Server-Sent Events
  useEffect(() => {
    const es = new EventSource(`${BACKEND_URL}/api/events/stream`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.event === "connected") return setLive(true);
      if (type && ev.event !== type) return;
      setEvents((list) => [{ ...ev, fresh: true }, ...list]);
    };
    return () => es.close();
  }, [type]);

  return (
    <section className="card">
      <div className="row between">
        <h2>Nhật ký sự kiện smart contract</h2>
        <span className={`chip ${live ? "ok" : "bad"}`}>
          <span className={`dot ${live ? "pulse" : ""}`} /> {live ? "Đang lắng nghe real-time" : "Mất kết nối"}
        </span>
      </div>
      <p className="muted">
        Backend truy xuất toàn bộ event đã xảy ra từ block deploy (<code>queryFilter</code>) và lắng nghe event mới (
        <code>contract.on</code>), sau đó đẩy về trình duyệt qua Server-Sent Events.
      </p>
      <div className="row">
        <label className="inline">Lọc theo loại event:</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t || "Tất cả"}</option>)}
        </select>
        <span className="muted">{events.length} event</span>
      </div>
      <table className="list">
        <thead><tr><th>Event</th><th>Chi tiết</th><th>Block</th><th>Thời gian</th><th>Tx</th><th>Nguồn</th></tr></thead>
        <tbody>
          {events.map((ev) => (
            <tr key={ev.id} className={ev.fresh ? "fresh" : ""}>
              <td><span className={`chip ev-${ev.event}`}>{ev.event}</span></td>
              <td>{describe(ev)}</td>
              <td>{ev.blockNumber}</td>
              <td>{fmtTime(ev.timestamp)}</td>
              <td className="mono">
                {txLink(ev.txHash) ? <a href={txLink(ev.txHash)} target="_blank" rel="noreferrer">{short(ev.txHash, 8, 6)}</a> : short(ev.txHash, 8, 6)}
              </td>
              <td><span className={`chip ${ev.source === "realtime" ? "ok" : ""}`}>{ev.source === "realtime" ? "Real-time" : "Lịch sử"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
