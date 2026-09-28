import { useEffect, useState, useCallback } from "react";
import { waitTx, api, decodeError, fmtTime, short, txLink } from "../web3";

export default function AdminPage({ wallet, connect, toast }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ address: "", name: "" });
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lastTx, setLastTx] = useState(null);

  const load = useCallback(async () => {
    setList(await api("/api/manufacturers"));
    if (wallet) setPaused(await wallet.contract.paused());
  }, [wallet]);

  useEffect(() => { load().catch(() => {}); const t = setInterval(() => load().catch(() => {}), 6000); return () => clearInterval(t); }, [load]);

  async function run(fn, okMsg) {
    setBusy(true);
    try {
      const tx = await fn();
      toast("Đã gửi giao dịch, đang chờ xác nhận…");
      await waitTx(tx);
      setLastTx(tx.hash);
      toast(okMsg, "success");
      await load();
    } catch (e) {
      toast(decodeError(e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!wallet)
    return (
      <section className="card center">
        <h2>Trang quản trị</h2>
        <p className="muted">Kết nối ví Admin (tài khoản đã deploy smart contract).</p>
        <button className="btn primary" onClick={connect}>Kết nối MetaMask</button>
      </section>
    );

  return (
    <>
      {wallet.role !== "admin" && (
        <div className="alert warn">
          Ví <span className="mono">{short(wallet.address)}</span> không phải Admin. Các thao tác bên dưới sẽ bị smart contract từ
          chối (<code>NotOwner</code>).
        </div>
      )}
      <div className="grid-2">
        <section className="card">
          <h2>Cấp quyền nhà sản xuất</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(() => wallet.contract.addManufacturer(form.address.trim(), form.name.trim()), `Đã cấp quyền cho ${form.name}`).then(
                () => setForm({ address: "", name: "" })
              );
            }}
          >
            <label>Địa chỉ ví nhà sản xuất *</label>
            <input className="mono" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="0x…" required />
            <label>Tên doanh nghiệp *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Công ty TNHH …" required />
            <button className="btn primary" disabled={busy}>{busy ? "Đang xử lý…" : "Cấp quyền"}</button>
          </form>
          {lastTx && (
            <div className="tx">
              Tx: {txLink(lastTx) ? <a className="mono" href={txLink(lastTx)} target="_blank" rel="noreferrer">{short(lastTx, 12, 8)}</a> : <span className="mono">{short(lastTx, 12, 8)}</span>}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Trạng thái hệ thống</h2>
          <div className={`verdict ${paused ? "revoked" : "ok"} compact`}>
            <div className="verdict-icon">{paused ? "!" : "✓"}</div>
            <div>
              <div className="verdict-title">{paused ? "ĐANG TẠM DỪNG" : "ĐANG HOẠT ĐỘNG"}</div>
              <div className="verdict-sub">Tạm dừng khẩn cấp chặn mọi thao tác đăng ký / xác thực.</div>
            </div>
          </div>
          <button
            className={`btn ${paused ? "primary" : "danger"}`}
            disabled={busy}
            onClick={() => run(() => wallet.contract.setPaused(!paused), paused ? "Đã mở lại hệ thống" : "Đã tạm dừng hệ thống")}
          >
            {paused ? "Mở lại hệ thống" : "Tạm dừng khẩn cấp"}
          </button>
        </section>
      </div>

      <section className="card">
        <div className="row between">
          <h2>Danh sách nhà sản xuất ({list.length})</h2>
          <button className="btn ghost" onClick={load}>Làm mới</button>
        </div>
        <table className="list">
          <thead><tr><th>Tên doanh nghiệp</th><th>Địa chỉ ví</th><th>Ngày cấp quyền</th><th>Số sản phẩm</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.address}>
                <td>{m.name}</td>
                <td className="mono">{short(m.address, 10, 6)}</td>
                <td>{fmtTime(m.registeredAt)}</td>
                <td>{m.productCount}</td>
                <td><span className={`chip ${m.isActive ? "ok" : "bad"}`}>{m.isActive ? "Được cấp quyền" : "Đã vô hiệu hoá"}</span></td>
                <td className="actions">
                  <button
                    className={`btn small ${m.isActive ? "danger" : ""}`}
                    disabled={busy}
                    onClick={() => run(() => wallet.contract.setManufacturerStatus(m.address, !m.isActive), "Đã cập nhật trạng thái")}
                  >
                    {m.isActive ? "Vô hiệu hoá" : "Kích hoạt lại"}
                  </button>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={6} className="muted">Chưa có nhà sản xuất.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
