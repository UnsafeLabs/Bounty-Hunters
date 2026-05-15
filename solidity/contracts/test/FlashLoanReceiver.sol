// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../FlashLoan.sol";
import "./RebasingTestToken.sol";

contract FlashLoanReceiver is IFlashLoanReceiver {
    enum Mode {
        Repay,
        RebaseThenRepay,
        DoNotRepay
    }

    IERC20 public immutable token;
    FlashLoan public immutable lender;
    Mode public mode;
    uint256 public rebaseAmount;
    uint256 public lastFee;

    constructor(address _token, address _lender) {
        token = IERC20(_token);
        lender = FlashLoan(_lender);
    }

    function setMode(Mode _mode, uint256 _rebaseAmount) external {
        mode = _mode;
        rebaseAmount = _rebaseAmount;
    }

    function borrow(uint256 amount) external {
        lender.flashLoan(amount, "");
    }

    function onFlashLoan(address, uint256 amount, uint256 fee, bytes calldata) external override {
        require(msg.sender == address(lender), "Unexpected lender");
        lastFee = fee;
        if (mode == Mode.RebaseThenRepay) {
            RebasingTestToken(address(token)).negativeRebase(address(lender), rebaseAmount);
        }
        if (mode != Mode.DoNotRepay) {
            token.transfer(address(lender), amount + fee);
        }
    }
}
