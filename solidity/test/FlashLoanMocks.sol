// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../contracts/FlashLoan.sol";

contract MockLoanToken is IERC20 {
    uint256 public override totalSupply;
    mapping(address => uint256) private balances;
    mapping(address => mapping(address => uint256)) public override allowance;
    mapping(address => uint256) public reportedBonus;

    function balanceOf(address account) external view override returns (uint256) {
        return balances[account] + reportedBonus[account];
    }

    function mint(address account, uint256 amount) external {
        balances[account] += amount;
        totalSupply += amount;
        emit Transfer(address(0), account, amount);
    }

    // Simulates a positive rebase during a borrower's callback without repayment.
    function setReportedBonus(address account, uint256 amount) external {
        reportedBonus[account] = amount;
    }

    function forceBurn(address account, uint256 amount) external {
        require(balances[account] >= amount, "Insufficient balance");
        balances[account] -= amount;
        totalSupply -= amount;
        emit Transfer(account, address(0), amount);
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "Insufficient allowance");
        allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(balances[from] >= amount, "Insufficient balance");
        balances[from] -= amount;
        balances[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract MockFlashBorrower is IFlashLoanReceiver {
    enum CallbackAction { ApproveRepayment, RebaseWithoutRepayment, DoNothing }

    FlashLoan public immutable pool;
    MockLoanToken public immutable token;
    uint256 public lastFee;

    constructor(MockLoanToken _token, FlashLoan _pool) {
        token = _token;
        pool = _pool;
    }

    function borrow(uint256 amount, CallbackAction action) external {
        pool.flashLoan(amount, abi.encode(action));
    }

    function onFlashLoan(address loanToken, uint256 amount, uint256 fee, bytes calldata data) external override {
        require(msg.sender == address(pool), "Not pool");
        require(loanToken == address(token), "Wrong token");
        lastFee = fee;

        CallbackAction action = abi.decode(data, (CallbackAction));
        if (action == CallbackAction.ApproveRepayment) {
            token.approve(address(pool), amount + fee);
        } else if (action == CallbackAction.RebaseWithoutRepayment) {
            token.setReportedBonus(address(pool), amount + fee);
        }
    }
}
