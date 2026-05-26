// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IFlashLoanReceiver {
    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external;
}

contract FlashLoan {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MAX_LOAN_BPS = 5000;

    IERC20 public loanToken;
    uint256 public feeBPS; // fee in basis points
    uint256 public totalFees;
    uint256 public poolBalance;
    address public owner;
    bool public paused;
    bool private loanInProgress;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event PoolDeposit(address indexed depositor, uint256 amount);
    event PauseUpdated(bool paused);
    event FeesWithdrawn(address indexed owner, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier noActiveLoan() {
        require(!loanInProgress, "Loan in progress");
        loanInProgress = true;
        _;
        loanInProgress = false;
    }

    constructor(address _loanToken, uint256 _feeBPS) {
        require(_loanToken != address(0), "Invalid token");
        require(_feeBPS <= BPS_DENOMINATOR, "Invalid fee");
        loanToken = IERC20(_loanToken);
        feeBPS = _feeBPS;
        owner = msg.sender;
    }

    function flashLoan(uint256 amount, bytes calldata data) external noActiveLoan {
        require(!paused, "Paused");
        require(amount > 0, "Amount must be > 0");
        require(amount <= maxLoanAmount(), "Amount exceeds max loan");

        uint256 fee = calculateFee(amount);
        poolBalance -= amount;

        loanToken.safeTransfer(msg.sender, amount);

        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);

        loanToken.safeTransferFrom(msg.sender, address(this), amount + fee);

        totalFees += fee;
        poolBalance += amount + fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        loanToken.safeTransferFrom(msg.sender, address(this), amount);
        poolBalance += amount;
        emit PoolDeposit(msg.sender, amount);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = totalFees;
        require(fees > 0, "No fees");
        totalFees = 0;
        poolBalance -= fees;
        loanToken.safeTransfer(owner, fees);
        emit FeesWithdrawn(owner, fees);
    }

    function pause() external onlyOwner {
        paused = true;
        emit PauseUpdated(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit PauseUpdated(false);
    }

    function calculateFee(uint256 amount) public view returns (uint256) {
        if (amount == 0) {
            return 0;
        }

        uint256 fee = amount * feeBPS / BPS_DENOMINATOR;
        if (amount * feeBPS % BPS_DENOMINATOR != 0) {
            fee += 1;
        }

        return fee == 0 ? 1 : fee;
    }

    function maxLoanAmount() public view returns (uint256) {
        return poolBalance * MAX_LOAN_BPS / BPS_DENOMINATOR;
    }

    function getPoolBalance() external view returns (uint256) {
        return poolBalance;
    }
}
