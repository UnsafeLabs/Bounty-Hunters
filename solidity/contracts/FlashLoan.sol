// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract FlashLoan {
    address public owner;
    bool public paused;
    uint256 public totalFees;
    uint256 public constant MAX_LOAN_RATIO = 50; // 50% of pool balance
    uint256 public feeBPS = 1; // 0.01% default fee
    bool private locked;

    event FlashLoan(address indexed borrower, uint256 amount, uint256 fee);
    event FeeCollected(uint256 fee);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event FeeUpdated(uint256 oldFee, uint256 newFee);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Flash loans are paused");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "ReentrancyGuard: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {}

    function setFeeBPS(uint256 _feeBPS) public onlyOwner {
        require(_feeBPS <= 1000, "Fee too high"); // max 10%
        emit FeeUpdated(feeBPS, _feeBPS);
        feeBPS = _feeBPS;
    }

    function pause() public onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() public onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function flashLoan(uint256 amount, address callback, bytes calldata data)
        public
        whenNotPaused
        nonReentrant
    {
        require(amount > 0, "Amount must be > 0");

        // Max loan cap: 50% of pool balance
        uint256 maxLoan = (address(this).balance * MAX_LOAN_RATIO) / 100;
        require(amount <= maxLoan, "Loan exceeds pool cap");

        // Fee: minimum 1 wei to prevent zero-fee exploit
        uint256 fee = (amount * feeBPS) / 10000;
        if (fee == 0) {
            fee = 1;
        }

        uint256 balanceBefore = address(this).balance;

        // Execute callback
        IFlashLoanCallback(callback).onFlashLoan(msg.sender, amount, fee, data);

        uint256 balanceAfter = address(this).balance;
        require(balanceAfter >= balanceBefore + fee, "Flash loan not repaid");

        totalFees += fee;
        emit FlashLoan(msg.sender, amount, fee);
        emit FeeCollected(fee);
    }

    function getMaxLoanAmount() public view returns (uint256) {
        return (address(this).balance * MAX_LOAN_RATIO) / 100;
    }

    function getPoolBalance() public view returns (uint256) {
        return address(this).balance;
    }
}

interface IFlashLoanCallback {
    function onFlashLoan(address initiator, uint256 amount, uint256 fee, bytes calldata data) external;
}
