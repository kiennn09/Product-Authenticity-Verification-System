const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("ProductAuthenticity", function () {
  let contract, admin, manufacturer, manufacturer2, customer, stranger;
  const CODE = "SH-2026-0001";

  beforeEach(async () => {
    [admin, manufacturer, manufacturer2, customer, stranger] = await ethers.getSigners();
    contract = await ethers.deployContract("ProductAuthenticity");
    await contract.addManufacturer(manufacturer.address, "Công ty ABC");
  });

  describe("1. Admin - quản lý nhà sản xuất", () => {
    it("owner là người deploy", async () => {
      expect(await contract.owner()).to.equal(admin.address);
    });

    it("admin thêm nhà sản xuất thành công và phát event ManufacturerAdded", async () => {
      await expect(contract.addManufacturer(manufacturer2.address, "Công ty XYZ"))
        .to.emit(contract, "ManufacturerAdded")
        .withArgs(manufacturer2.address, "Công ty XYZ", anyValue);
      expect(await contract.isManufacturer(manufacturer2.address)).to.equal(true);
      expect(await contract.getAllManufacturers()).to.have.length(2);
    });

    it("[FAIL] người không phải admin không thể thêm nhà sản xuất", async () => {
      await expect(
        contract.connect(stranger).addManufacturer(stranger.address, "Fake Co")
      ).to.be.revertedWithCustomError(contract, "NotOwner");
    });

    it("[FAIL] không thể thêm trùng nhà sản xuất / địa chỉ 0 / tên rỗng", async () => {
      await expect(contract.addManufacturer(manufacturer.address, "Again"))
        .to.be.revertedWithCustomError(contract, "ManufacturerAlreadyExists");
      await expect(contract.addManufacturer(ethers.ZeroAddress, "Zero"))
        .to.be.revertedWithCustomError(contract, "ZeroAddress");
      await expect(contract.addManufacturer(manufacturer2.address, ""))
        .to.be.revertedWithCustomError(contract, "EmptyValue");
    });

    it("admin vô hiệu hoá nhà sản xuất => không đăng ký được sản phẩm nữa", async () => {
      await expect(contract.setManufacturerStatus(manufacturer.address, false))
        .to.emit(contract, "ManufacturerStatusChanged");
      await expect(
        contract.connect(manufacturer).registerProduct(CODE, "Nồi cơm", "L01", "")
      ).to.be.revertedWithCustomError(contract, "NotAuthorizedManufacturer");
    });
  });

  describe("2. Manufacturer - đăng ký & thu hồi sản phẩm", () => {
    it("đăng ký sản phẩm thành công và phát event ProductRegistered", async () => {
      const key = ethers.keccak256(ethers.toUtf8Bytes(CODE));
      await expect(
        contract.connect(manufacturer).registerProduct(CODE, "Nồi cơm điện", "LOT-01", "1.8L")
      )
        .to.emit(contract, "ProductRegistered")
        .withArgs(key, CODE, "Nồi cơm điện", "LOT-01", manufacturer.address, anyValue);

      const [authentic, product, mName] = await contract.checkProduct(CODE);
      expect(authentic).to.equal(true);
      expect(product.name).to.equal("Nồi cơm điện");
      expect(product.status).to.equal(1n);
      expect(mName).to.equal("Công ty ABC");
      expect(await contract.getProductCount()).to.equal(1n);
    });

    it("[FAIL] tài khoản chưa được cấp quyền không thể đăng ký", async () => {
      await expect(
        contract.connect(stranger).registerProduct(CODE, "Hàng giả", "X", "")
      ).to.be.revertedWithCustomError(contract, "NotAuthorizedManufacturer");
    });

    it("[FAIL] không thể đăng ký trùng mã sản phẩm", async () => {
      await contract.connect(manufacturer).registerProduct(CODE, "A", "L1", "");
      await expect(
        contract.connect(manufacturer).registerProduct(CODE, "B", "L2", "")
      ).to.be.revertedWithCustomError(contract, "ProductAlreadyRegistered");
    });

    it("[FAIL] không thể đăng ký với mã rỗng", async () => {
      await expect(
        contract.connect(manufacturer).registerProduct("", "A", "L1", "")
      ).to.be.revertedWithCustomError(contract, "EmptyValue");
    });

    it("nhà sản xuất thu hồi sản phẩm, phát event ProductRevoked", async () => {
      await contract.connect(manufacturer).registerProduct(CODE, "A", "L1", "");
      await expect(contract.connect(manufacturer).revokeProduct(CODE, "Lô lỗi"))
        .to.emit(contract, "ProductRevoked");
      const [authentic, product] = await contract.checkProduct(CODE);
      expect(authentic).to.equal(false);
      expect(product.status).to.equal(2n);
    });

    it("[FAIL] nhà sản xuất khác không được thu hồi sản phẩm không phải của mình", async () => {
      await contract.addManufacturer(manufacturer2.address, "XYZ");
      await contract.connect(manufacturer).registerProduct(CODE, "A", "L1", "");
      await expect(contract.connect(manufacturer2).revokeProduct(CODE, "x"))
        .to.be.revertedWithCustomError(contract, "NotProductManufacturer");
    });
  });

  describe("3. Customer - xác thực sản phẩm", () => {
    beforeEach(async () => {
      await contract.connect(manufacturer).registerProduct(CODE, "Nồi cơm điện", "LOT-01", "");
    });

    it("xác thực sản phẩm chính hãng: authentic = true, lưu lịch sử, phát event ProductVerified", async () => {
      await expect(contract.connect(customer).verifyProduct(CODE))
        .to.emit(contract, "ProductVerified")
        .withArgs(anyValue, CODE, customer.address, true, 1n, anyValue);
      await contract.connect(customer).verifyProduct(CODE);

      const history = await contract.getVerificationHistory(CODE);
      expect(history).to.have.length(2);
      expect(history[0].verifier).to.equal(customer.address);
      const [, product] = await contract.checkProduct(CODE);
      expect(product.verificationCount).to.equal(2n);
      expect(await contract.totalVerifications()).to.equal(2n);
    });

    it("xác thực mã không tồn tại (hàng giả): authentic = false", async () => {
      await expect(contract.connect(customer).verifyProduct("FAKE-999"))
        .to.emit(contract, "ProductVerified")
        .withArgs(anyValue, "FAKE-999", customer.address, false, 0n, anyValue);
      expect(await contract.totalFailedVerifications()).to.equal(1n);
    });

    it("xác thực sản phẩm đã bị thu hồi: authentic = false", async () => {
      await contract.connect(manufacturer).revokeProduct(CODE, "Lô lỗi");
      expect(await contract.connect(customer).verifyProduct.staticCall(CODE)).to.equal(false);
    });

    it("checkProduct là hàm view, không tốn gas, không ghi lịch sử", async () => {
      await contract.checkProduct(CODE);
      expect(await contract.getVerificationHistory(CODE)).to.have.length(0);
    });
  });

  describe("4. Bảo mật - tạm dừng khẩn cấp", () => {
    it("admin tạm dừng contract => không đăng ký / xác thực được", async () => {
      await expect(contract.setPaused(true)).to.emit(contract, "Paused");
      await expect(
        contract.connect(manufacturer).registerProduct(CODE, "A", "L1", "")
      ).to.be.revertedWithCustomError(contract, "ContractPaused");
      await expect(contract.verifyProduct(CODE)).to.be.revertedWithCustomError(contract, "ContractPaused");
    });

    it("[FAIL] người thường không thể tạm dừng / chuyển quyền owner", async () => {
      await expect(contract.connect(stranger).setPaused(true))
        .to.be.revertedWithCustomError(contract, "NotOwner");
      await expect(contract.connect(stranger).transferOwnership(stranger.address))
        .to.be.revertedWithCustomError(contract, "NotOwner");
    });
  });
});
