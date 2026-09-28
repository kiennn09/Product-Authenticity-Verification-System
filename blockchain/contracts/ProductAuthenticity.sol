// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  ProductAuthenticity
 * @notice Hệ thống xác thực hàng chính hãng trên blockchain.
 *         - Admin (owner) cấp / thu hồi quyền cho nhà sản xuất.
 *         - Nhà sản xuất được cấp quyền đăng ký sản phẩm với mã định danh duy nhất.
 *         - Bất kỳ ai (khách hàng hoặc backend thay mặt khách hàng) đều có thể
 *           xác thực sản phẩm; mỗi lần xác thực được lưu lại trên chuỗi.
 */
contract ProductAuthenticity {
    // ------------------------------------------------------------------
    // Kiểu dữ liệu
    // ------------------------------------------------------------------
    enum ProductStatus {
        NotRegistered, // 0 - chưa đăng ký (mặc định)
        Active,        // 1 - đang lưu hành, chính hãng
        Revoked        // 2 - đã bị nhà sản xuất thu hồi
    }

    struct Manufacturer {
        string name;
        bool isActive;
        uint64 registeredAt;
        uint256 productCount;
    }

    struct Product {
        string productCode;      // mã định danh (in trên tem / QR)
        string name;
        string batchNumber;
        string description;
        address manufacturer;
        uint64 registeredAt;
        ProductStatus status;
        uint256 verificationCount;
    }

    struct VerificationRecord {
        address verifier;
        uint64 timestamp;
        bool authentic;
    }

    // ------------------------------------------------------------------
    // Trạng thái
    // ------------------------------------------------------------------
    address public owner;
    bool public paused;

    mapping(address => Manufacturer) private manufacturers;
    address[] private manufacturerList;

    mapping(bytes32 => Product) private products;           // key = keccak256(productCode)
    mapping(bytes32 => VerificationRecord[]) private verificationHistory;
    bytes32[] private productKeys;

    uint256 public totalVerifications;
    uint256 public totalFailedVerifications;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ManufacturerAdded(address indexed manufacturer, string name, uint256 timestamp);
    event ManufacturerStatusChanged(address indexed manufacturer, bool isActive, uint256 timestamp);
    event ProductRegistered(
        bytes32 indexed productKey,
        string productCode,
        string name,
        string batchNumber,
        address indexed manufacturer,
        uint256 timestamp
    );
    event ProductRevoked(bytes32 indexed productKey, string productCode, address indexed manufacturer, string reason, uint256 timestamp);
    event ProductVerified(
        bytes32 indexed productKey,
        string productCode,
        address indexed verifier,
        bool authentic,
        uint256 verificationCount,
        uint256 timestamp
    );
    event Paused(bool isPaused, uint256 timestamp);

    // ------------------------------------------------------------------
    // Custom errors (tiết kiệm gas hơn chuỗi revert)
    // ------------------------------------------------------------------
    error NotOwner();
    error NotAuthorizedManufacturer();
    error NotProductManufacturer();
    error ContractPaused();
    error ZeroAddress();
    error EmptyValue();
    error ManufacturerAlreadyExists();
    error ManufacturerNotFound();
    error ProductAlreadyRegistered();
    error ProductNotFound();
    error ProductAlreadyRevoked();

    // ------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyActiveManufacturer() {
        if (!manufacturers[msg.sender].isActive) revert NotAuthorizedManufacturer();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    modifier nonEmpty(string calldata value) {
        if (bytes(value).length == 0) revert EmptyValue();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ------------------------------------------------------------------
    // Quản trị (Admin)
    // ------------------------------------------------------------------
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused, block.timestamp);
    }

    function addManufacturer(address account, string calldata name)
        external
        onlyOwner
        nonEmpty(name)
    {
        if (account == address(0)) revert ZeroAddress();
        if (manufacturers[account].registeredAt != 0) revert ManufacturerAlreadyExists();

        manufacturers[account] = Manufacturer({
            name: name,
            isActive: true,
            registeredAt: uint64(block.timestamp),
            productCount: 0
        });
        manufacturerList.push(account);
        emit ManufacturerAdded(account, name, block.timestamp);
    }

    function setManufacturerStatus(address account, bool isActive) external onlyOwner {
        if (manufacturers[account].registeredAt == 0) revert ManufacturerNotFound();
        manufacturers[account].isActive = isActive;
        emit ManufacturerStatusChanged(account, isActive, block.timestamp);
    }

    // ------------------------------------------------------------------
    // Nhà sản xuất (Manufacturer)
    // ------------------------------------------------------------------
    function registerProduct(
        string calldata productCode,
        string calldata name,
        string calldata batchNumber,
        string calldata description
    ) external whenNotPaused onlyActiveManufacturer nonEmpty(productCode) nonEmpty(name) {
        bytes32 key = keccak256(bytes(productCode));
        if (products[key].status != ProductStatus.NotRegistered) revert ProductAlreadyRegistered();

        products[key] = Product({
            productCode: productCode,
            name: name,
            batchNumber: batchNumber,
            description: description,
            manufacturer: msg.sender,
            registeredAt: uint64(block.timestamp),
            status: ProductStatus.Active,
            verificationCount: 0
        });
        productKeys.push(key);
        manufacturers[msg.sender].productCount += 1;

        emit ProductRegistered(key, productCode, name, batchNumber, msg.sender, block.timestamp);
    }

    function revokeProduct(string calldata productCode, string calldata reason) external whenNotPaused {
        bytes32 key = keccak256(bytes(productCode));
        Product storage p = products[key];
        if (p.status == ProductStatus.NotRegistered) revert ProductNotFound();
        if (p.manufacturer != msg.sender) revert NotProductManufacturer();
        if (p.status == ProductStatus.Revoked) revert ProductAlreadyRevoked();

        p.status = ProductStatus.Revoked;
        emit ProductRevoked(key, productCode, msg.sender, reason, block.timestamp);
    }

    // ------------------------------------------------------------------
    // Xác thực (Customer / Backend)
    // ------------------------------------------------------------------
    /**
     * @notice Ghi nhận một lần xác thực lên blockchain.
     * @return authentic true nếu sản phẩm đã đăng ký và đang Active.
     */
    function verifyProduct(string calldata productCode)
        external
        whenNotPaused
        nonEmpty(productCode)
        returns (bool authentic)
    {
        bytes32 key = keccak256(bytes(productCode));
        Product storage p = products[key];
        authentic = (p.status == ProductStatus.Active);

        if (p.status != ProductStatus.NotRegistered) {
            p.verificationCount += 1;
        }
        totalVerifications += 1;
        if (!authentic) totalFailedVerifications += 1;

        verificationHistory[key].push(
            VerificationRecord({verifier: msg.sender, timestamp: uint64(block.timestamp), authentic: authentic})
        );

        emit ProductVerified(key, productCode, msg.sender, authentic, p.verificationCount, block.timestamp);
    }

    // ------------------------------------------------------------------
    // Hàm đọc (view) - miễn phí gas
    // ------------------------------------------------------------------
    function checkProduct(string calldata productCode)
        external
        view
        returns (bool authentic, Product memory product, string memory manufacturerName)
    {
        bytes32 key = keccak256(bytes(productCode));
        product = products[key];
        authentic = (product.status == ProductStatus.Active);
        manufacturerName = manufacturers[product.manufacturer].name;
    }

    function getVerificationHistory(string calldata productCode)
        external
        view
        returns (VerificationRecord[] memory)
    {
        return verificationHistory[keccak256(bytes(productCode))];
    }

    function getManufacturer(address account) external view returns (Manufacturer memory) {
        return manufacturers[account];
    }

    function isManufacturer(address account) external view returns (bool) {
        return manufacturers[account].isActive;
    }

    function getAllManufacturers() external view returns (address[] memory) {
        return manufacturerList;
    }

    function getProductCount() external view returns (uint256) {
        return productKeys.length;
    }

    function getProductByIndex(uint256 index) external view returns (Product memory) {
        return products[productKeys[index]];
    }
}
