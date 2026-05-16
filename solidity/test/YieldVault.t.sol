// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/YieldVault.sol";

interface Vm {
    function expectRevert(bytes calldata revertData) external;
    function prank(address caller) external;
    function warp(uint256 newTimestamp) external;
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
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract YieldVaultTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockERC20 private stakingToken;
    MockERC20 private rewardToken;
    YieldVault private vault;

    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    function setUp() public {
        stakingToken = new MockERC20("Stake", "STK");
        rewardToken = new MockERC20("Reward", "RWD");
        vault = new YieldVault(address(stakingToken), address(rewardToken));

        stakingToken.mint(ALICE, 1_000 ether);
        stakingToken.mint(BOB, 1_000 ether);
        rewardToken.mint(address(vault), 1_000 ether);

        vm.prank(ALICE);
        stakingToken.approve(address(vault), type(uint256).max);

        vm.prank(BOB);
        stakingToken.approve(address(vault), type(uint256).max);
    }

    function testRewardAccruesDuringPeriod() public {
        vm.warp(100);
        vault.notifyRewardAmount(100 ether, 100);

        vm.prank(ALICE);
        vault.deposit(10 ether);

        vm.warp(150);
        assertApproxEqAbs(vault.earned(ALICE), 50 ether, 1);
        assertApproxEqAbs(vault.rewardPerToken(), 5 ether, 1);
    }

    function testRewardsFreezeAfterPeriodFinish() public {
        vm.warp(100);
        vault.notifyRewardAmount(100 ether, 100);

        vm.prank(ALICE);
        vault.deposit(10 ether);

        vm.warp(200);
        uint256 earnedAtFinish = vault.earned(ALICE);
        uint256 rewardPerTokenAtFinish = vault.rewardPerToken();

        vm.warp(300);
        assertEq(vault.earned(ALICE), earnedAtFinish);
        assertEq(vault.rewardPerToken(), rewardPerTokenAtFinish);

        vm.prank(BOB);
        vault.deposit(10 ether);

        vm.warp(400);
        assertEq(vault.earned(BOB), 0);
        assertEq(vault.earned(ALICE), earnedAtFinish);
        assertEq(vault.rewardPerToken(), rewardPerTokenAtFinish);
    }

    function testUnauthorizedNotifyRewardAmountReverts() public {
        vm.expectRevert(bytes("Not reward distributor"));
        vm.prank(ALICE);
        vault.notifyRewardAmount(100 ether, 100);
    }

    function testRewardRatePrecisionLossIsBelowOneBasisPoint() public {
        uint256 reward = 1 ether;
        uint256 duration = 3;

        vm.warp(100);
        vault.notifyRewardAmount(reward, duration);

        vm.prank(ALICE);
        vault.deposit(1 ether);

        vm.warp(103);
        uint256 earned = vault.earned(ALICE);
        uint256 error = earned > reward ? earned - reward : reward - earned;

        assertLt(error * 1_000_000, reward * 100);
    }

    function testDepositWithdrawAndClaimFlowsStillWork() public {
        vm.warp(100);
        vault.notifyRewardAmount(100 ether, 100);

        vm.prank(ALICE);
        vault.deposit(10 ether);

        vm.warp(150);

        vm.prank(ALICE);
        vault.withdraw(4 ether);

        assertEq(vault.balanceOf(ALICE), 6 ether);
        assertEq(stakingToken.balanceOf(ALICE), 994 ether);

        vm.prank(ALICE);
        vault.claimReward();

        assertApproxEqAbs(rewardToken.balanceOf(ALICE), 50 ether, 1);
        assertEq(vault.rewards(ALICE), 0);
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "not equal");
    }

    function assertApproxEqAbs(uint256 actual, uint256 expected, uint256 maxDelta) internal pure {
        uint256 delta = actual > expected ? actual - expected : expected - actual;
        require(delta <= maxDelta, "not approximately equal");
    }

    function assertLt(uint256 actual, uint256 expected) internal pure {
        require(actual < expected, "not less than");
    }
}
