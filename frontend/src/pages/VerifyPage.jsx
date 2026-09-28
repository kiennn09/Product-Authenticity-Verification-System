import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { waitTx, api, decodeError, fmtTime, short, txLink } from "../web3";

const SUSPICIOUS_SCANS = 5;

export default function VerifyPage({ wallet, toast }) {
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("code") || "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef(null);
  const autoRan = useRef(false);

  // Nếu mở trang bằng link QR (?code=...) thì tự động xác thực (chỉ 1 lần)
  useEffect(() => {
    if (code && !autoRan.current) {
      autoRan.current = true;
      verify(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify(value = code, viaWallet = false) {
    const c = value.trim();
    if (!c) return toast("Vui lòng nhập mã sản phẩm", "error");
    setLoading(true);
    setResult(null);
    try {
      if (viaWallet) {
        // Khách hàng tự ký giao dịch bằng MetaMask
        const tx = await wallet.contract.verifyProduct(c);
        toast(`Đã gửi giao dịch ${short(tx.hash, 10, 6)} — đang chờ xác nhận…`);
        await waitTx(tx);
        const r = await api(`/api/products/${encodeURIComponent(c)}`);
        const history = await api(`/api/products/${encodeURIComponent(c)}/history`);
        setResult({ ...r, txHash: tx.hash, recordedOnChain: true, verificationHistory: history, code: c });
      } else {
        // Qua dịch vụ xác thực của backend
        const r = await api("/api/verify", { method: "POST", body: JSON.stringify({ code: c }) });
        setResult({ ...r, code: c });
      }
    } catch (e) {
      toast(decodeError(e), "error");
    } finally {
      setLoading(false);
    }
  }

  async function startScan() {
    setScanning(true);
    setTimeout(async () => {
      try {
        const qr = new Html5Qrcode("qr-reader");
        scannerRef.current = qr;
        await qr.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 }, (text) => {
          let value = text;
          try { value = new URL(text).searchParams.get("code") || text; } catch { /* not a URL */ }
          setCode(value);
          stopScan();
          verify(value);
        });
      } catch (e) {
        toast("Không mở được camera: " + (e?.message || e), "error");
        setScanning(false);
      }
    }, 50);
  }

  async function stopScan() {
    try { await scannerRef.current?.stop(); } catch { /* ignore */ }
    setScanning(false);
  }

  const status = result ? (result.authentic ? "ok" : result.registered ? "revoked" : "fake") : null;

  return (
    <div className="grid-2">
      <section className="card">
        <h2>Kiểm tra sản phẩm chính hãng</h2>
        <p className="muted">Nhập mã định danh in trên tem sản phẩm hoặc quét mã QR.</p>
        <label>Mã sản phẩm</label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && verify()}
          placeholder="VD: APX-2026-000001"
          className="mono"
        />
        <div className="row">
          <button className="btn primary" disabled={loading} onClick={() => verify()}>
            {loading ? "Đang xác thực…" : "Xác thực"}
          </button>
          <button className="btn" onClick={scanning ? stopScan : startScan}>
            {scanning ? "Tắt camera" : "Quét mã QR"}
          </button>
          {wallet && (
            <button className="btn ghost" disabled={loading} onClick={() => verify(code, true)}>
              Xác thực bằng ví của tôi
            </button>
          )}
        </div>
        {scanning && <div id="qr-reader" className="qr-reader" />}
        <div className="hint">
          Mỗi lần xác thực được ghi lại vĩnh viễn trên blockchain (event <code>ProductVerified</code>). Khách hàng không
          cần ví — backend sẽ gửi giao dịch thay.
        </div>
      </section>

      <section className="card">
        {!result && !loading && <div className="empty">Kết quả xác thực sẽ hiển thị ở đây.</div>}
        {loading && <div className="empty"><span className="spinner" /> Đang truy vấn blockchain…</div>}
        {result && (
          <>
            <div className={`verdict ${status}`}>
              <div className="verdict-icon">{status === "ok" ? "✓" : status === "revoked" ? "!" : "✕"}</div>
              <div>
                <div className="verdict-title">
                  {status === "ok" && "SẢN PHẨM CHÍNH HÃNG"}
                  {status === "revoked" && "SẢN PHẨM ĐÃ BỊ THU HỒI"}
                  {status === "fake" && "KHÔNG TÌM THẤY — CÓ THỂ LÀ HÀNG GIẢ"}
                </div>
                <div className="verdict-sub mono">{result.code}</div>
              </div>
            </div>

            {result.product && (
              <table className="kv">
                <tbody>
                  <tr><th>Tên sản phẩm</th><td>{result.product.name}</td></tr>
                  <tr><th>Lô sản xuất</th><td>{result.product.batchNumber || "—"}</td></tr>
                  <tr><th>Mô tả</th><td>{result.product.description || "—"}</td></tr>
                  <tr><th>Nhà sản xuất</th><td>{result.product.manufacturerName}<br /><span className="mono muted">{result.product.manufacturer}</span></td></tr>
                  <tr><th>Ngày đăng ký</th><td>{fmtTime(result.product.registeredAt)}</td></tr>
                  <tr><th>Trạng thái</th><td>{result.product.status}</td></tr>
                  <tr><th>Số lần xác thực</th><td>{result.product.verificationCount}</td></tr>
                </tbody>
              </table>
            )}

            {result.product && result.product.verificationCount > SUSPICIOUS_SCANS && (
              <div className="alert warn">
                Mã này đã được quét {result.product.verificationCount} lần. Nếu bạn là người mua đầu tiên, mã có thể đã bị sao chép.
              </div>
            )}

            {result.txHash && (
              <div className="tx">
                Đã ghi lên blockchain — Tx:{" "}
                {txLink(result.txHash) ? (
                  <a href={txLink(result.txHash)} target="_blank" rel="noreferrer" className="mono">{short(result.txHash, 12, 8)}</a>
                ) : (
                  <span className="mono">{short(result.txHash, 12, 8)}</span>
                )}
              </div>
            )}

            {result.verificationHistory?.length > 0 && (
              <>
                <h3>Lịch sử xác thực trên blockchain</h3>
                <table className="list">
                  <thead><tr><th>#</th><th>Thời gian</th><th>Người xác thực</th><th>Kết quả</th></tr></thead>
                  <tbody>
                    {[...result.verificationHistory].reverse().slice(0, 8).map((h, i, arr) => (
                      <tr key={i}>
                        <td>{result.verificationHistory.length - i}</td>
                        <td>{fmtTime(h.timestamp)}</td>
                        <td className="mono">{short(h.verifier)}</td>
                        <td><span className={`chip ${h.authentic ? "ok" : "bad"}`}>{h.authentic ? "Hợp lệ" : "Không hợp lệ"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
