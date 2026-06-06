// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/FlashLoan.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockRebasingERC20 is ERC20 {
    address public bonusAccount;
    uint256 public bonusAmount;

    constructor() ERC20("Rebasing Token", "RBS") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBalanceBonus(address account, uint256 amount) external {
        bonusAccount = account;
        bonusAmount = amount;
    }

    function balanceOf(address account) public view override returns (uint256) {
        uint256 baseBalance = super.balanceOf(account);
        return account == bonusAccount ? baseBalance + bonusAmount : baseBalance;
    }
}

contract RepayingBorrower is IFlashLoanReceiver {
    function execute(address lender, uint256 amount) external {
        FlashLoan(lender).flashLoan(amount, "");
    }

    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata) external {
        IERC20(token).approve(msg.sender, amount + fee);
    }
}

contract NonRepayingRebaseBorrower is IFlashLoanReceiver {
    function execute(address lender, uint256 amount) external {
        FlashLoan(lender).flashLoan(amount, "");
    }

    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata) external {
        MockRebasingERC20(token).setBalanceBonus(msg.sender, amount + fee);
    }
}
