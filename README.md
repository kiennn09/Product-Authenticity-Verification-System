# AuthentiChain – Hệ thống xác thực hàng chính hãng trên Blockchain (Nhóm 14)

Gồm 3 phần:

| Thư mục | Nội dung |
|---|---|
| `blockchain/` | Smart contract `ProductAuthenticity.sol` (Solidity 0.8.24), unit test, script deploy/seed (Hardhat) |
| `backend/` | API Node.js/Express: xác thực sản phẩm (relayer), lắng nghe event real-time + lịch sử, SSE, QR |
| `frontend/` | React + Vite: MetaMask, trang Khách hàng / Nhà sản xuất / Quản trị / Sự kiện, quét & tạo QR |
| `sepolia-console/` | Trang HTML deploy + chạy kịch bản trên Sepolia bằng MetaMask (không cần Node) |

## Yêu cầu
- Node.js 18+ (khuyến nghị 20/22), trình duyệt có MetaMask.

## 1. Smart contract
```bash
cd blockchain
npm install
npx hardhat test                 # 17 unit test
REPORT_GAS=true npx hardhat test # (tuỳ chọn) báo cáo gas
```

### Chạy local
```bash
npx hardhat node                                          # cửa sổ 1
npx hardhat run scripts/deploy.js --network localhost     # cửa sổ 2
npx hardhat run scripts/seed.js   --network localhost
```

### Deploy Sepolia bằng Hardhat
Tạo `blockchain/.env` (xem `.env.example`) với `PRIVATE_KEY` của ví TEST rồi:
```bash
npx hardhat run scripts/deploy.js --network sepolia
npx hardhat run scripts/seed.js   --network sepolia
npx hardhat verify --network sepolia <ĐỊA_CHỈ_CONTRACT>   # verify trên Blockscout
```
Script deploy tự ghi `contract.sepolia.json` vào `backend/src` và `frontend/src`.

> Nếu đã deploy bằng `sepolia-console`, file `contract.sepolia.json` đã được tạo sẵn trong `backend/src` và `frontend/src`.

## 2. Backend
```bash
cd backend
npm install
cp .env.example .env    # sửa NETWORK=sepolia, RELAYER_PRIVATE_KEY=...
npm start               # http://localhost:4000/api/health
```

## 3. Frontend
```bash
cd frontend
npm install
# .env:  VITE_NETWORK=sepolia   VITE_BACKEND_URL=http://localhost:4000
npm run dev             # http://localhost:5173
```
Mở trình duyệt có MetaMask, chọn mạng Sepolia:
- Ví đã deploy contract = **Admin**
- Ví được Admin cấp quyền = **Nhà sản xuất**
- Ai cũng là **Khách hàng** (không cần ví)

Để quét QR bằng điện thoại trong cùng mạng Wi-Fi: `npm run dev -- --host`, rồi mở `http://<IP máy tính>:5173` (camera trên điện thoại cần HTTPS hoặc dùng chức năng nhập mã).

## Bảo mật
Không commit file `.env`. Chỉ dùng ví test cho đồ án.
