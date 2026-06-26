// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public poolBalance;
    uint256 public totalFees;
    address public owner;
    bool public paused;
    bool private activeLoan;

    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MAX_LOAN_BPS = 5000;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PoolDeposit(address indexed provider, uint256 amount);
    event FeesWithdrawn(address indexed owner, uint256 amount);
    event Paused(address indexed owner);
    event Unpaused(address indexed owner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_loanToken != address(0), "Invalid token");
        require(_feeBPS <= BPS_DENOMINATOR, "Invalid fee");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function flashLoan(uint256 amount, bytes calldata data) external whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        require(!activeLoan, "Flash loan active");

        uint256 availableLiquidity = poolBalance;
        require(availableLiquidity >= amount, "Insufficient pool balance");
        require(amount <= availableLiquidity * MAX_LOAN_BPS / BPS_DENOMINATOR, "Loan exceeds cap");

        uint256 fee = _calculateFee(amount);
        uint256 repayment = amount + fee;

        activeLoan = true;
        poolBalance = availableLiquidity - amount;

        _safeTransfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        _safeTransferFrom(msg.sender, address(this), repayment);

        poolBalance += repayment;
        totalFees += fee;
        activeLoan = false;

        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(!activeLoan, "Flash loan active");
        _safeTransferFrom(msg.sender, address(this), amount);
        poolBalance += amount;
        emit PoolDeposit(msg.sender, amount);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees");
        require(poolBalance >= fees, "Insufficient fees");
        totalFees = 0;
        poolBalance -= fees;
        _safeTransfer(owner, fees);
        emit FeesWithdrawn(owner, fees);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }

    function calculateFee(uint256 amount) external view returns (uint256) {
        return _calculateFee(amount);
    }

    function _calculateFee(uint256 amount) internal view returns (uint256) {
        if (amount == 0) {
            return 0;
        }
        uint256 fee = amount * feeBPS / BPS_DENOMINATOR;
        return fee == 0 ? 1 : fee;
    }

    function _safeTransfer(address to, uint256 amount) internal {
        require(loanToken.transfer(to, amount), "Transfer failed");
    }

    function _safeTransferFrom(address from, address to, uint256 amount) internal {
        require(loanToken.transferFrom(from, to, amount), "Transfer failed");
    }
}
