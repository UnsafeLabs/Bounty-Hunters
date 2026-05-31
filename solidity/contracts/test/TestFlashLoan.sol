// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../FlashLoan.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockFlashLoanReceiver is IFlashLoanReceiver {
    IERC20 public token;
    bool public shouldRepay;

    constructor(address _token) {
        token = IERC20(_token);
        shouldRepay = true;
    }

    function setShouldRepay(bool _shouldRepay) external {
        shouldRepay = _shouldRepay;
    }

    function onFlashLoan(address, uint256 amount, uint256 fee, bytes calldata) external override {
        if (shouldRepay) {
            // Transfer repayment (amount + fee) back to flash loan contract
            token.transfer(msg.sender, amount + fee);
        }
        // If shouldRepay is false, simulate non-repayment (attack scenario)
    }
}
