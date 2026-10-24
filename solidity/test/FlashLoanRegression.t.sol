// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../contracts/FlashLoan.sol";

contract MockERC20 is IERC20 {
    string public constant name = "Mock";
    string public constant symbol = "MOCK";
    uint8 public constant decimals = 18;
    uint256 public override totalSupply;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract FlashLoanReceiver is IFlashLoanReceiver {
    FlashLoan public immutable loan;
    MockERC20 public immutable token;

    constructor(FlashLoan _loan, MockERC20 _token) {
        loan = _loan;
        token = _token;
    }

    function execute(uint256 amount) external {
        loan.flashLoan(amount, "");
    }

    function onFlashLoan(address, uint256 amount, uint256 fee, bytes calldata) external override {
        require(msg.sender == address(loan), "unexpected caller");
        require(token.transfer(address(loan), amount + fee), "repay failed");
    }
}

contract FlashLoanRegressionTest {
    MockERC20 private token;
    FlashLoan private loan;
    FlashLoanReceiver private receiver;

    function setUp() public {
        token = new MockERC20();
        loan = new FlashLoan(address(token), 30);
        receiver = new FlashLoanReceiver(loan, token);
        token.mint(address(this), 1_000);
        token.approve(address(loan), 1_000);
        loan.depositToPool(1_000);
        token.mint(address(receiver), 100);
    }

    function testMinimumFeeForSmallLoan() public {
        setUp();
        receiver.execute(1);
        require(loan.totalFees() == 1, "fee was zero");
        require(loan.accountedPoolBalance() == 1_001, "accounting mismatch");
    }

    function testLoanCannotExceedHalfOfAccountedPool() public {
        setUp();
        bool reverted;
        try receiver.execute(501) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "pool cap bypassed");
    }

    function testPauseAndUnpause() public {
        setUp();
        loan.pause();
        bool reverted;
        try receiver.execute(100) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "paused loan succeeded");
        loan.unpause();
        receiver.execute(100);
        require(loan.totalFees() == 1, "unpaused loan failed");
    }

    function testUntrackedTokenBalanceDoesNotRaiseLoanCap() public {
        setUp();
        token.mint(address(loan), 1_000);
        bool reverted;
        try receiver.execute(501) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "raw balance bypassed accounting");
    }

    function testOwnerCanWithdrawOnlyAccruedFees() public {
        setUp();
        receiver.execute(100);
        uint256 ownerBefore = token.balanceOf(address(this));
        loan.withdrawFees();
        require(token.balanceOf(address(this)) == ownerBefore + 1, "fee withdrawal mismatch");
        require(loan.accountedPoolBalance() == 1_000, "principal was withdrawn");
        require(loan.totalFees() == 0, "fees not cleared");
    }
}
