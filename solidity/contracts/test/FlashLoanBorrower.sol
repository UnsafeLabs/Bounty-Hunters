// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../FlashLoan.sol";

contract FlashLoanBorrower is IFlashLoanReceiver {
    address public immutable lender;
    IERC20 public immutable token;

    constructor(address _lender, address _token) {
        lender = _lender;
        token = IERC20(_token);
    }

    function onFlashLoan(address loanToken, uint256 amount, uint256 fee, bytes calldata) external {
        require(msg.sender == lender, "Unexpected lender");
        require(loanToken == address(token), "Unexpected token");
        require(token.transfer(msg.sender, amount + fee), "Repayment failed");
    }
}
