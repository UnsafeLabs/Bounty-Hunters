// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MockERC20
 * @notice Simple ERC20 for testing
 */
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title MockRebasingToken
 * @notice ERC20 that simulates rebasing behavior by inflating balance
 */
contract MockRebasingToken is ERC20 {
    uint256 public scaleFactor = 1e18;

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function balanceOf(address account) public view override returns (uint256) {
        // Simulate rebasing: return 10x balance
        return super.balanceOf(account) * 10;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        // Adjust for rebase in actual transfer
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        return super.transferFrom(from, to, amount);
    }
}

/**
 * @title MockFlashLoanReceiver
 * @notice Test receiver that properly repays the loan
 */
contract MockFlashLoanReceiver {
    IERC20 public token;

    constructor(address _token) {
        token = IERC20(_token);
    }

    function onFlashLoan(address _token, uint256 amount, uint256 fee, bytes calldata) external {
        // Approve repayment
        token.approve(msg.sender, amount + fee);
    }
}

/**
 * @title MockFlashLoanReceiverNoRepay
 * @notice Test receiver that does NOT repay (should fail)
 */
contract MockFlashLoanReceiverNoRepay {
    function onFlashLoan(address, uint256, uint256, bytes calldata) external {
        // Do nothing — don't approve repayment
    }
}
