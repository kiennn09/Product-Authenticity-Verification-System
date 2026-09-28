import { useEffect, useState, useCallback } from "react";
import QRCode from "qrcode";
import { waitTx, api, decodeError, fmtTime, short, txLink, verifyUrl } from "../web3";

function randomCode() {
  const n = Math.floor(Math.random() * 1e6).toString().padStart(6, "0");
  return `APX-${new Date().getFullYear()}-${n}`;
}

function TxNote({ hash }) {
  if (!hash) return null;
  const link = txLink(hash);
  return (
    <div className="tx">
      Tx:{" "}
      {link ? <a href={link} target="_blank" rel="noreferrer" className="mono">{short(hash, 12, 8)}</a> : <span className="mono">{short(hash, 12, 8)}</span>}
    </div>
  );
}

export default function ManufacturerPage({ wallet, connect, toast }) {
  const [form, setForm] = useState({ productCode: randomCode(), name: "", batchNumber: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [lastTx, setLastTx] = useState(null);
  const [qr, setQr] = useState(null);
  const [products, setProducts] = useState([]);

  const load = useCallback(async () => {
    if (!wallet) return;
    setProducts(await api(`/api/products?manufacturer=${wallet.address}`));
  }, [wallet]);

  useEffect(() => { load(); const t = setInterval(() => load().catch(() => {}), 6000); return () => clearInterval(t); }, [load]);

  async function showQr(code) {
    setQr({ code, url: await QRCode.toDataURL(verifyUrl(code), { width: 260, margin: 2 }) });
  }

  async function register(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { productCode, name, batchNumber, description } = form;
      const tx = await wallet.contract.registerProduct(productCode.trim(), name.trim(), batchNumber.trim(), description.trim());
      toast("Đã gửi giao dịch đăng ký, đang chờ xác nhận…");
      await waitTx(tx);
      setLastTx(tx.hash);
      toast(`Đăng ký thành công sản phẩm ${productCode}`, "success");
      await showQr(productCode.trim());
      setForm({ productCode: randomCode(), name: form.name, batchNumber: form.batchNumber, description: form.description });
      load();
    } catch (err) {
      toast(decodeError(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(code) {
    const reason = prompt(`Lý do thu hồi sản phẩm ${code}?`, "Lô hàng lỗi");
    if (reason === null) return;
    try {
      const tx = await wallet.contract.revokeProduct(code, reason);
      await waitTx(tx);
      setLastTx(tx.hash);
      toast(`Đã thu hồi ${code}`, "success");
      load();
    } catch (err) {
      toast(decodeError(err), "error");
    }
  }

  if (!wallet)
    return (
      <section className="card center">
        <h2>Cổng nhà sản xuất</h2>
        <p className="muted">Kết nối ví MetaMask đã được Admin cấp quyền để đăng ký sản phẩm.</p>
        <button className="btn primary" onClick={connect}>Kết nối MetaMask</button>
      </section>
    );

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      {wallet.role !== "manufacturer" && (
        <div className="alert warn">
          Ví <span className="mono">{short(wallet.address)}</span> chưa được cấp quyền nhà sản xuất. Giao dịch đăng ký sẽ bị smart
          contract từ chối (<code>NotAuthorizedManufacturer</code>).
        </div>
      )}
      <div className="grid-2">
        <section className="card">
          <h2>Đăng ký sản phẩm mới</h2>
          {wallet.role === "manufacturer" && <p className="muted">Nhà sản xuất: <b>{wallet.manufacturerName}</b></p>}
          <form onSubmit={register}>
            <label>Mã định danh sản phẩm *</label>
            <div className="row">
              <input className="mono" value={form.productCode} onChange={set("productCode")} required />
              <button type="button" className="btn ghost" onClick={() => setForm({ ...form, productCode: randomCode() })}>Tạo mã</button>
            </div>
            <label>Tên sản phẩm *</label>
            <input value={form.name} onChange={set("name")} placeholder="VD: Nồi cơm điện AnPhat RC-18" required />
            <label>Số lô sản xuất</label>
            <input value={form.batchNumber} onChange={set("batchNumber")} placeholder="VD: LOT-2026-09A" />
            <label>Mô tả</label>
            <textarea value={form.description} onChange={set("description")} rows={2} placeholder="Thông số, xuất xứ…" />
            <button className="btn primary" disabled={busy}>{busy ? "Đang ghi lên blockchain…" : "Đăng ký lên blockchain"}</button>
          </form>
          <TxNote hash={lastTx} />
        </section>

        <section className="card center">
          <h2>Mã QR sản phẩm</h2>
          {qr ? (
            <>
              <img src={qr.url} alt="QR" className="qr" />
              <div className="mono">{qr.code}</div>
              <p className="muted small">In mã này lên tem sản phẩm. Khách hàng quét để mở trang xác thực.</p>
              <a className="btn" href={qr.url} download={`${qr.code}.png`}>Tải ảnh QR</a>
            </>
          ) : (
            <div className="empty">Đăng ký sản phẩm hoặc chọn một sản phẩm bên dưới để xem mã QR.</div>
          )}
        </section>
      </div>

      <section className="card">
        <div className="row between">
          <h2>Sản phẩm của tôi ({products.length})</h2>
          <button className="btn ghost" onClick={load}>Làm mới</button>
        </div>
        <table className="list">
          <thead>
            <tr><th>Mã</th><th>Tên sản phẩm</th><th>Lô</th><th>Ngày đăng ký</th><th>Lượt xác thực</th><th>Trạng thái</th><th></th></tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.productCode}>
                <td className="mono">{p.productCode}</td>
                <td>{p.name}</td>
                <td>{p.batchNumber}</td>
                <td>{fmtTime(p.registeredAt)}</td>
                <td>{p.verificationCount}</td>
                <td><span className={`chip ${p.status === "Active" ? "ok" : "bad"}`}>{p.status === "Active" ? "Đang lưu hành" : "Đã thu hồi"}</span></td>
                <td className="actions">
                  <button className="btn small ghost" onClick={() => showQr(p.productCode)}>QR</button>
                  {p.status === "Active" && <button className="btn small danger" onClick={() => revoke(p.productCode)}>Thu hồi</button>}
                </td>
              </tr>
            ))}
            {!products.length && <tr><td colSpan={7} className="muted">Chưa có sản phẩm.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
