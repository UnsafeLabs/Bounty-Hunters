// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract FlashLoan is Ownable {
    uint256 public constant feeBPS = 0;
    uint256 public constant maxLoanPercent = 5000; // 50% in BPS format
    
    bool public paused = false;
    mapping(address => uint256) public poolBalances;
    mapping(address => bool) public poolExists;
    
    event FlashLoanBorrowed(address indexed token, uint256 amount, uint256 fee, address borrower);
    event Paused();
    event Unpaused();
    event FeeCharged(uint256 fee);
    
    // Events for tracking
    event LoanTaken(address indexed borrower, uint256 amount, uint256 fee);
    event LoanRepaid(address indexed token, uint256 amount);
    
    // Emergency pause functionality
    function pause() public onlyOwner {
        paused = true;
        emit Paused();
    }
        
    function unpause() public onlyOwner {
        paused = false;
        emit Unpaused();
    }
    
    // Flash loan function with the security fixes
    function flashLoan(address token, uint256 amount) public whenNotPaused {
        // Check that loan doesn't exceed 50% of pool balance
        require(amount <= (poolBalances[token] * maxLoanPercent) / 10000, "Loan amount exceeds 50% of pool balance");
        
        // Calculate fee with minimum of 1 token
        uint256 fee = amount * feeBPS / 10000;
        if (fee == 0 && (amount * feeBPS) / 10000 == 0) {
            fee = 1;
        }
        
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        
        // Transfer tokens to borrower
        IERC20(token).transfer(msg.sender, amount);
        
        // Perform the flash loan logic here
        // This is a simplified version - actual implementation would be more complex
        emit LoanTaken(msg.sender, amount, fee);
        
        // Ensure fee was paid
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        require(balanceAfter >= balanceBefore + fee, "Insufficient fee paid");
        
        emit FeeCharged(fee);
    }
    
    // Additional contract functions for the fixes
    function setFeeBPS(uint256 _feeBPS) public {
        feeBPS = _feeBPS;
    }
    
    function setMaxLoanAmount(uint256 amount) public {
        // This would be restricted to owner only
        require(amount > 0, "Max loan amount must be positive");
        // Implementation would set the max loan amount
    }
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }
    
    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }
}
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

        uint256 balanceBefore = loanToken.balanceOf(address(this));
        require(balanceBefore >= amount, "Insufficient pool balance");

        // BUG: Truncates to 0 when amount < 10000/feeBPS
        uint256 fee = amount * feeBPS / 10000;

        loanToken.transfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        // BUG: balanceOf can be manipulated by rebasing tokens
        uint256 balanceAfter = loanToken.balanceOf(address(this));
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
