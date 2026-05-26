// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanReceiver { function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata data) external; }

contract FlashLoan {
    IERC20 public loanToken; uint256 public feeBPS; uint256 public totalFees;
    address public owner; bool public paused; uint256 public internalBalance;
    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event EmergencyPaused(address indexed by); event EmergencyUnpaused(address indexed by);

    constructor(address _loanToken, uint256 _feeBPS) { loanToken = IERC20(_loanToken); feeBPS = _feeBPS; owner = msg.sender; }
    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }

    function flashLoan(uint256 amount, bytes calldata data) external {
        require(!paused, "Paused"); require(amount > 0, "Amount must be > 0");
        uint256 poolBalance = internalBalance; require(poolBalance >= amount, "Insufficient pool balance");
        uint256 maxLoan = poolBalance / 2; require(amount <= maxLoan, "Exceeds max loan amount");
        uint256 fee = amount * feeBPS / 10000; if (fee < 1) fee = 1;
        internalBalance -= amount; loanToken.transfer(msg.sender, amount);
        IFlashLoanReceiver(msg.sender).onFlashLoan(address(loanToken), amount, fee, data);
        internalBalance = internalBalance + amount + fee; totalFees += fee;
        emit FlashLoanExecuted(msg.sender, amount, fee);
    }

    function depositToPool(uint256 amount) external { loanToken.transferFrom(msg.sender, address(this), amount); internalBalance += amount; }
    function withdrawFees() external onlyOwner { uint256 fees = totalFees; totalFees = 0; loanToken.transfer(owner, fees); }
    function pause() external onlyOwner { paused = true; emit EmergencyPaused(msg.sender); }
    function unpause() external onlyOwner { paused = false; emit EmergencyUnpaused(msg.sender); }
    function getPoolBalance() external view returns (uint256) { return internalBalance; }
}
