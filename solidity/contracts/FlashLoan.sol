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
// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IFlashLoanReceiver {
    function executeOperation(uint256 loanAmount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan is Ownable {
    IERC20 public token;
    uint256 public feeBPS;
    uint256 public totalFees;
    bool public paused;

    struct FlashLoanData {
        address initiator;
        bytes data;
    }

    event FlashLoan(address indexed borrower, uint256 amount, uint256 fee);
    event Paused(bool isPaused);

    constructor(address _token, uint256 _feeBPS) {
        require(_feeBPS <= 10000, "Fee too high");
        token = IERC20(_token);
        feeBPS = _feeBPS;
    }

    modifier whenNotPaused() {
        require(!paused, "Flash loans are paused");
        _;
    }

    modifier nonRebasingOnly() {
        _;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function flashLoan(uint256 loanAmount, bytes calldata data) external whenNotPaused nonRebasingOnly {
        require(loanAmount > 0, "Loan amount must be greater than 0");

        uint256 balanceBefore = token.balanceOf(address(this));

        uint256 fee = loanAmount * feeBPS / 10000;
        if (fee == 0) {
            fee = 1;
        }

        uint256 maxLoanAmount = balanceBefore / 2;
        require(loanAmount <= maxLoanAmount, "Loan exceeds maximum allowed");

        token.transfer(msg.sender, loanAmount);

        IFlashLoanReceiver(msg.sender).executeOperation(loanAmount, fee, data);

 augmented
        uint256 balanceAfter = token.balanceOf(address(this));
        require(balanceAfter >= balanceBefore + fee, "Flash loan not repaid");

        totalFees += fee;

        emit FlashLoan(msg.sender, loanAmount, fee);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        totalFees = 0;
        token.transfer(owner(), fees);
    }
}
}
