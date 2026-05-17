// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface IERC20 { function transfer(address,uint256) external returns(bool); function balanceOf(address) external view returns(uint256); }
interface IFlashLoanReceiver { function executeOperation(address,uint256,uint256,bytes calldata) external returns(bool); }
contract FlashLoan {
  mapping(address=>uint256) public liquidity;
  uint256 public constant FEE_BPS = 9;
  event FlashLoan(address indexed receiver, address token, uint256 amount, uint256 fee);
  function deposit(address token, uint256 amount) external { liquidity[token] += amount; }
  function flashLoan(address receiver, address token, uint256 amount, bytes calldata params) external {
    uint256 pool = liquidity[token]; require(amount > 0, "Zero"); require(pool >= amount, "Pool drained");
    uint256 fee = (amount * FEE_BPS) / 10000;
    require(IFlashLoanReceiver(receiver).executeOperation(token, amount, fee, params), "Receiver failed");
    require(IERC20(token).balanceOf(address(this)) >= pool + fee, "Not repaid");
    liquidity[token] = pool + fee;
    emit FlashLoan(receiver, token, amount, fee);
  }
}