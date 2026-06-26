// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "./FlashLoan.sol";

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract MockRebasingToken {
    string public name;
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    bool public rebasing;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function setRebasing(bool _rebasing) external {
        rebasing = _rebasing;
    }

    function inflate(address target, uint256 amount) external {
        balanceOf[target] += amount;
        emit Transfer(address(0), target, amount);
    }

    function deflate(address target, uint256 amount) external {
        require(balanceOf[target] >= amount);
        balanceOf[target] -= amount;
        emit Transfer(target, address(0), amount);
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract MaliciousReceiver {
    FlashLoan internal _flashLoan;
    bool public steal;

    constructor(FlashLoan flashLoan_) {
        _flashLoan = flashLoan_;
    }

    function setSteal(bool _steal) external {
        steal = _steal;
    }

    function onFlashLoan(address token, uint256, uint256, bytes calldata) external {
        if (steal) {
            MockERC20(token).transfer(address(this), MockERC20(token).balanceOf(address(_flashLoan)));
        }
    }
}

contract RebasingAttackReceiver {
    FlashLoan internal _flashLoan;
    MockRebasingToken internal _token;
    uint256 public inflateAmount;
    uint256 public deflateAmount;

    constructor(FlashLoan flashLoan_, MockRebasingToken token_) {
        _flashLoan = flashLoan_;
        _token = token_;
    }

    function setInflateAmount(uint256 amount) external {
        inflateAmount = amount;
    }

    function setDeflateAmount(uint256 amount) external {
        deflateAmount = amount;
    }

    function onFlashLoan(address, uint256, uint256, bytes calldata) external {
        if (inflateAmount > 0) {
            _token.inflate(address(_flashLoan), inflateAmount);
        }
        if (deflateAmount > 0) {
            _token.deflate(address(_flashLoan), deflateAmount);
        }
    }
}

contract FlashLoanTest is Test, IFlashLoanReceiver {
    MockERC20 token;
    FlashLoan flashLoan;
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    uint256 constant FEE_BPS = 10;
    uint256 constant DEPOSIT_AMOUNT = 100_000 ether;

    event FlashLoanExecuted(address indexed borrower, uint256 amount, uint256 fee);
    event Paused();
    event Unpaused();
    event Deposited(address indexed user, uint256 amount);

    function setUp() public {
        token = new MockERC20("Test", "TST", 18);
        flashLoan = new FlashLoan(address(token), FEE_BPS);

        token.mint(ALICE, DEPOSIT_AMOUNT);
        token.mint(address(this), 1_000_000 ether);

        vm.startPrank(ALICE);
        token.approve(address(flashLoan), DEPOSIT_AMOUNT);
        flashLoan.depositToPool(DEPOSIT_AMOUNT);
        vm.stopPrank();
    }

    function onFlashLoan(address _token, uint256 amount, uint256 fee, bytes calldata) external {
        MockERC20(_token).transfer(msg.sender, amount + fee);
    }

    // --- Zero-fee prevention ---

    function test_MinimumFeeForSmallAmount() public {
        uint256 tinyAmount = 1;
        assertEq(tinyAmount * FEE_BPS / 10000, 0);

        uint256 poolBefore = token.balanceOf(address(flashLoan));
        flashLoan.flashLoan(tinyAmount, "");
        assertEq(token.balanceOf(address(flashLoan)), poolBefore + 1);
    }

    function test_FeeNonZeroForAllAmounts() public {
        for (uint256 i = 1; i <= 1000; i++) {
            uint256 poolBefore = token.balanceOf(address(flashLoan));
            if (poolBefore < i) break;
            flashLoan.flashLoan(i, "");
            uint256 poolAfter = token.balanceOf(address(flashLoan));
            assertTrue(poolAfter > poolBefore, "Fee must be positive");
        }
    }

    // --- Max loan cap ---

    function test_MaxLoanCapHalf() public {
        uint256 cap = flashLoan.totalDeposits() / 2;
        flashLoan.flashLoan(cap, "");
    }

    function test_MaxLoanCapExceeded() public {
        uint256 cap = flashLoan.totalDeposits() / 2;
        vm.expectRevert("Exceeds max loan cap");
        flashLoan.flashLoan(cap + 1, "");
    }

    function test_MaxLoanCapUsesTotalDeposits() public {
        token.mint(BOB, 50_000 ether);
        vm.startPrank(BOB);
        token.approve(address(flashLoan), 50_000 ether);
        flashLoan.depositToPool(50_000 ether);
        vm.stopPrank();

        uint256 newCap = flashLoan.totalDeposits() / 2;
        assertEq(newCap, (DEPOSIT_AMOUNT + 50_000 ether) / 2);
        flashLoan.flashLoan(newCap, "");
    }

    // --- Pause / Unpause ---

    function test_Pause() public {
        flashLoan.pause();
        vm.expectRevert("Paused");
        flashLoan.flashLoan(100, "");
    }

    function test_Unpause() public {
        flashLoan.pause();
        flashLoan.unpause();
        flashLoan.flashLoan(100, "");
    }

    function test_OnlyOwnerCanPause() public {
        vm.prank(BOB);
        vm.expectRevert("Not owner");
        flashLoan.pause();
    }

    function test_OnlyOwnerCanUnpause() public {
        flashLoan.pause();
        vm.prank(BOB);
        vm.expectRevert("Not owner");
        flashLoan.unpause();
    }

    function test_PauseEmitsEvent() public {
        vm.expectEmit(true, true, true, true);
        emit Paused();
        flashLoan.pause();
    }

    function test_UnpauseEmitsEvent() public {
        flashLoan.pause();
        vm.expectEmit(true, true, true, true);
        emit Unpaused();
        flashLoan.unpause();
    }

    // --- Fee accrual ---

    function test_FeeAccrual() public {
        flashLoan.flashLoan(1_000 ether, "");
        uint256 expectedFee = 1_000 ether * FEE_BPS / 10000;
        if (expectedFee == 0) expectedFee = 1;
        assertEq(flashLoan.totalFees(), expectedFee);
    }

    function test_MultipleLoansAccrue() public {
        flashLoan.flashLoan(1_000 ether, "");
        flashLoan.flashLoan(2_000 ether, "");

        uint256 fee1 = 1_000 ether * FEE_BPS / 10000;
        if (fee1 == 0) fee1 = 1;
        uint256 fee2 = 2_000 ether * FEE_BPS / 10000;
        if (fee2 == 0) fee2 = 1;

        assertEq(flashLoan.totalFees(), fee1 + fee2);
    }

    // --- Owner / Access ---

    function test_OwnerCanWithdrawFees() public {
        flashLoan.flashLoan(1_000 ether, "");
        uint256 feesBefore = flashLoan.totalFees();
        uint256 balanceBefore = token.balanceOf(address(this));

        flashLoan.withdrawFees();

        assertEq(token.balanceOf(address(this)), balanceBefore + feesBefore);
        assertEq(flashLoan.totalFees(), 0);
    }

    function test_OnlyOwnerCanWithdrawFees() public {
        flashLoan.flashLoan(1_000 ether, "");
        vm.prank(BOB);
        vm.expectRevert("Not owner");
        flashLoan.withdrawFees();
    }

    // --- Deposits ---

    function test_DepositToPool() public {
        token.mint(BOB, 10_000 ether);
        vm.startPrank(BOB);
        token.approve(address(flashLoan), 10_000 ether);
        flashLoan.depositToPool(10_000 ether);
        vm.stopPrank();

        assertEq(flashLoan.totalDeposits(), DEPOSIT_AMOUNT + 10_000 ether);
    }

    // --- Edge cases ---

    function test_RevertWhenAmountZero() public {
        vm.expectRevert("Amount must be > 0");
        flashLoan.flashLoan(0, "");
    }

    function test_RevertWhenInsufficientPool() public {
        uint256 excessive = DEPOSIT_AMOUNT + 1;
        vm.expectRevert("Exceeds max loan cap");
        flashLoan.flashLoan(excessive, "");
    }

    function test_RevertWhenLoanNotRepaid() public {
        MaliciousReceiver attacker = new MaliciousReceiver(flashLoan);
        attacker.setSteal(true);

        vm.prank(address(attacker));
        vm.expectRevert();
        flashLoan.flashLoan(100 ether, "");
    }

    // --- Rebasing token protection ---

    function test_RebasingInflationDetected() public {
        MockRebasingToken rebaseToken = new MockRebasingToken("RBT", "RBT", 18);
        FlashLoan rebaseLoan = new FlashLoan(address(rebaseToken), FEE_BPS);

        rebaseToken.mint(ALICE, 100_000 ether);
        vm.startPrank(ALICE);
        rebaseToken.approve(address(rebaseLoan), 100_000 ether);
        rebaseLoan.depositToPool(100_000 ether);
        vm.stopPrank();

        RebasingAttackReceiver attacker = new RebasingAttackReceiver(rebaseLoan, rebaseToken);

        rebaseToken.mint(address(attacker), 1_000_000 ether);
        attacker.setInflateAmount(1_000_000 ether);

        vm.prank(address(attacker));
        vm.expectRevert();
        rebaseLoan.flashLoan(1_000 ether, "");
    }

    function test_RebasingDeflationDetected() public {
        MockRebasingToken rebaseToken = new MockRebasingToken("RBT", "RBT", 18);
        FlashLoan rebaseLoan = new FlashLoan(address(rebaseToken), FEE_BPS);

        rebaseToken.mint(ALICE, 100_000 ether);
        vm.startPrank(ALICE);
        rebaseToken.approve(address(rebaseLoan), 100_000 ether);
        rebaseLoan.depositToPool(100_000 ether);
        vm.stopPrank();

        RebasingAttackReceiver attacker = new RebasingAttackReceiver(rebaseLoan, rebaseToken);

        rebaseToken.mint(address(attacker), 1_000_000 ether);
        attacker.setDeflateAmount(500 ether);

        vm.prank(address(attacker));
        vm.expectRevert();
        rebaseLoan.flashLoan(1_000 ether, "");
    }

    // --- Drainage protection ---

    function test_CannotDrainPool() public {
        vm.expectRevert("Exceeds max loan cap");
        flashLoan.flashLoan(DEPOSIT_AMOUNT, "");
    }

    function test_CannotDrainWithMultipleLoans() public {
        uint256 cap = flashLoan.totalDeposits() / 2;
        flashLoan.flashLoan(cap, "");

        vm.expectRevert("Exceeds max loan cap");
        flashLoan.flashLoan(cap + 1, "");
    }
}
