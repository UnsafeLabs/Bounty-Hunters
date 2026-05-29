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
    address public owner;
    bool public paused;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);

    constructor(address _loanToken, uint256 _feeBPS) {
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    // BUG: Fee truncates to zero for small loan amounts
    // BUG: No max loan amount — can drain entire pool
    // BUG: Uses balanceOf for validation — rebasing tokens can manipulate
    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
    uint256 public constant feeBPS = 30; // 0.3% fee
    uint256 public constant MIN_LOAN_AMOUNT = 1000 * 1e18; // 1000 tokens minimum for loans
    
    // Add minimum fee and max loan amount protection
    uint256 public maxLoanAmountPercentage = 50; // 50% of pool balance
    bool public paused = false;
    
    function calculateFee(uint256 loanAmount) internal view returns (uint256) {
        return loanAmount * feeBPS / 10000;
    }

        loanToken.transfer(msg.sender, amount);
    }

    function executeFlashLoan(uint256 amount) public {
        require(!paused, "Contract is paused");
        require(amount <= (getPoolBalance() * 50) / 100, "Loan amount exceeds 50% of pool balance");
        
        uint256 balanceBefore = getContractBalance();
        uint256 fee = calculateFee(amount);
        if (fee == 0) {
            fee = 1; // Minimum fee of 1 token unit
        }
        
        // Existing flash loan logic...
        require(repayAmount <= balanceBefore + fee, "Insufficient fee paid");
    }
}

modifier nonRebasingOnly() {
    _;
}

modifier whenNotPaused() {
    require(!paused, "Contract is paused");
    _;
}

function setMaxLoanAmount(uint256 _maxAmount) public onlyOwner {
    MAX_LOAN_AMOUNT = _maxAmount;
}

modifier onlyOwner() {
    require(msg.sender == owner, "Not owner");
    _;
}
    }
        require(balanceAfter >= balanceBefore + fee, "Loan not repaid");

        totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        loanToken.transferFrom(msg.sender, address(this), amount);
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Not owner");
        uint256 fees = totalFees;
        totalFees = 0;
        loanToken.transfer(owner, fees);
    }

    // BUG: No emergency pause function
    function getPoolBalance() external view returns (uint256) {
        return loanToken.balanceOf(address(this));
    }
}
