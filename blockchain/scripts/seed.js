// Tạo dữ liệu mẫu: cấp quyền nhà sản xuất và đăng ký một số sản phẩm.
// - localhost: dùng các tài khoản có sẵn của Hardhat.
// - sepolia : dùng MANUFACTURER_PRIVATE_KEY trong .env (nếu thiếu sẽ tạo ví mới
//             và chuyển một ít SepoliaETH từ ví admin để trả phí gas).
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const PRODUCTS = [
  ["APX-2026-000001", "Nồi cơm điện AnPhat RC-18", "LOT-2026-09A", "Dung tích 1.8L, lòng nồi chống dính"],
  ["APX-2026-000002", "Nồi cơm điện AnPhat RC-18", "LOT-2026-09A", "Dung tích 1.8L, lòng nồi chống dính"],
  ["APX-2026-000003", "Máy xay sinh tố AnPhat BL-500", "LOT-2026-09B", "Công suất 500W, cối thuỷ tinh"],
  ["APX-2026-000004", "Ấm siêu tốc AnPhat KT-17", "LOT-2026-09C", "1.7L, inox 304"],
];

async function main() {
  const { ethers, network } = hre;
  const info = JSON.parse(
    fs.readFileSync(path.join(__dirname, `../../backend/src/contract.${network.name}.json`), "utf8")
  );
  const [admin, ...rest] = await ethers.getSigners();

  let manufacturer;
  if (network.name === "localhost" || network.name === "hardhat") {
    manufacturer = rest[0];
  } else {
    let pk = process.env.MANUFACTURER_PRIVATE_KEY;
    if (!pk) {
      const w = ethers.Wallet.createRandom();
      pk = w.privateKey;
      fs.appendFileSync(path.join(__dirname, "../.env"), `\nMANUFACTURER_PRIVATE_KEY=${pk}\n`);
      console.log(`Tạo ví nhà sản xuất mới: ${w.address} (đã lưu vào .env)`);
    }
    manufacturer = new ethers.Wallet(pk, ethers.provider);
    const bal = await ethers.provider.getBalance(manufacturer.address);
    if (bal < ethers.parseEther("0.005")) {
      const tx = await admin.sendTransaction({ to: manufacturer.address, value: ethers.parseEther("0.01") });
      await tx.wait();
      console.log(`Chuyển 0.01 ETH cho nhà sản xuất: ${tx.hash}`);
    }
  }

  const contract = await ethers.getContractAt("ProductAuthenticity", info.address, admin);
  console.log(`Admin        : ${admin.address}`);
  console.log(`Manufacturer : ${manufacturer.address}`);

  const m = await contract.getManufacturer(manufacturer.address);
  if (m.registeredAt === 0n) {
    const tx = await contract.addManufacturer(manufacturer.address, "Công ty TNHH Điện gia dụng An Phát");
    await tx.wait();
    console.log(`addManufacturer      tx: ${tx.hash}`);
  }

  const asM = contract.connect(manufacturer);
  for (const [code, name, batch, desc] of PRODUCTS) {
    const [, p] = await contract.checkProduct(code);
    if (p.status !== 0n) continue;
    const tx = await asM.registerProduct(code, name, batch, desc);
    await tx.wait();
    console.log(`registerProduct ${code} tx: ${tx.hash}`);
  }
  console.log("Seed xong.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
