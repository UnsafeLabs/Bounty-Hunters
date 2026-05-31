// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/FlashLoan.sol";

interface Vm {
    function expectRevert() external;
    function expectRevert(bytes calldata revertData) external;
}

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract RepayingReceiver is IFlashLoanReceiver {
    FlashLoan private lender;

    constructor(FlashLoan _lender) {
        lender = _lender;
    }

    function execute(uint256 amount) external {
        lender.flashLoan(amount, "");
    }

    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata) external {
        MockERC20(token).approve(msg.sender, amount + fee);
    }
}

contract RebaseOnlyReceiver is IFlashLoanReceiver {
    FlashLoan private lender;

    constructor(FlashLoan _lender) {
        lender = _lender;
    }

    function execute(uint256 amount) external {
        lender.flashLoan(amount, "");
    }

    function onFlashLoan(address token, uint256 amount, uint256 fee, bytes calldata) external {
        MockERC20(token).mint(msg.sender, fee);
        MockERC20(token).approve(msg.sender, amount);
    }
}

contract FlashLoanTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockERC20 private token;
    FlashLoan private lender;

    function setUp() public {
        token = new MockERC20("Loan", "LOAN");
        lender = new FlashLoan(address(token), 1);
        token.mint(address(this), 10_000);
        token.approve(address(lender), type(uint256).max);
        lender.depositToPool(10_000);
    }

    function testMinimumFeePreventsZeroFeeLoan() public {
        RepayingReceiver receiver = new RepayingReceiver(lender);
        token.mint(address(receiver), 1);

        receiver.execute(1);

        require(lender.totalFees() == 1, "minimum fee not charged");
        require(lender.getPoolBalance() == 10_001, "fee not accrued");
    }

    function testMaxLoanCapRejectsPoolDrainage() public {
        RepayingReceiver receiver = new RepayingReceiver(lender);
        token.mint(address(receiver), 1_000);

        vm.expectRevert(bytes("Loan exceeds cap"));
        receiver.execute(5_001);
    }

    function testRebasingBalanceManipulationDoesNotRepayLoan() public {
        RebaseOnlyReceiver receiver = new RebaseOnlyReceiver(lender);

        vm.expectRevert();
        receiver.execute(100);
    }

    function testPauseAndUnpauseControlsFlashLoans() public {
        RepayingReceiver receiver = new RepayingReceiver(lender);
        token.mint(address(receiver), 1);

        lender.pause();
        vm.expectRevert(bytes("Paused"));
        receiver.execute(1);

        lender.unpause();
        receiver.execute(1);
        require(lender.totalFees() == 1, "loan did not run after unpause");
    }

    function testWithdrawFeesUsesInternalAccounting() public {
        RepayingReceiver receiver = new RepayingReceiver(lender);
        token.mint(address(receiver), 1);
        receiver.execute(1);

        uint256 ownerBefore = token.balanceOf(address(this));
        lender.withdrawFees();

        require(token.balanceOf(address(this)) == ownerBefore + 1, "owner missing fees");
        require(lender.totalFees() == 0, "fees not reset");
        require(lender.getPoolBalance() == 10_000, "accounted pool not reduced");
    }
}
