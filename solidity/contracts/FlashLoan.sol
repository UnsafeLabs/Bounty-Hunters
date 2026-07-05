// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    IERC20 public loanToken;
    uint256 public feeBPS;
    uint256 public totalFees;
    address public owner;
    bool public paused;

    uint256 public maxLoanBPS = 5000;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused();
    event Unpaused();

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");

        uint256 balanceBefore = loanToken.balanceOf(address(this));
        require(balanceBefore >= amount, "Insufficient pool balance");

        require(amount <= balanceBefore * maxLoanBPS / 10000, "Exceeds max loan amount");

        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0) fee = 1;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        require(loanToken.balanceOf(address(this)) >= balanceBefore + fee, "Loan not repaid");

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        totalFees = 0;
        loanToken.transfer(owner, fees);
    }

    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused();
    }

    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused();
    }

    function setMaxLoanBPS(uint256 _maxLoanBPS) external onlyOwner {
        require(_maxLoanBPS <= 10000, "Max loan BPS exceeds 100%");
        maxLoanBPS = _maxLoanBPS;
    }

    function getPoolBalance() external view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }
}
