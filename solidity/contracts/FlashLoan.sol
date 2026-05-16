// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    uint256 public poolBalance;
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Deposited(address indexed depositor, uint256 amount);
    event FeesWithdrawn(address indexed owner, uint256 amount);
    event Paused(address indexed owner);
    event Unpaused(address indexed owner);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    modifier nonRebasingOnly() {
        require(
            loanToken.balanceOf(address(this)) == poolBalance + totalFees,
            "Unaccounted token balance"
        );
        _;
    }

    function calculateFee(uint256 amount) public view returns (uint256) {
        uint256 proportionalFee = amount * feeBPS / 10000;
        return proportionalFee == 0 ? 1 : proportionalFee;
    }

    function maxLoanAmount() public view returns (uint256) {
        return poolBalance / 2;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        flashLoan(amount, data, msg.sender);
    }

    function flashLoan(
        uint256 amount,
        bytes calldata data,
        address receiver
    ) public whenNotPaused nonRebasingOnly {
        require(amount > 0, "Amount must be > 0");
        require(receiver != address(0), "Invalid receiver");
        require(amount <= maxLoanAmount(), "Amount exceeds loan cap");
        require(poolBalance >= amount, "Insufficient pool balance");

        uint256 balanceBefore = loanToken.balanceOf(address(this));
        uint256 fee = calculateFee(amount);

        require(loanToken.transfer(receiver, amount), "Transfer failed");

        IFlashLoanReceiver(receiver).onFlashLoan(address(loanToken), amount, fee, data);

        uint256 balanceAfter = loanToken.balanceOf(address(this));
        require(balanceAfter == balanceBefore + fee, "Loan not repaid exactly");

        totalFees += fee;
        emit FlashLoanExecuted(receiver, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        uint256 balanceBefore = loanToken.balanceOf(address(this));
        require(loanToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        uint256 received = loanToken.balanceOf(address(this)) - balanceBefore;
        require(received > 0, "No tokens received");
        poolBalance += received;
        emit Deposited(msg.sender, received);
    }

    function withdrawFees() external onlyOwner nonRebasingOnly {
        uint256 fees = totalFees;
        totalFees = 0;
        require(loanToken.transfer(owner, fees), "Transfer failed");
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
}
