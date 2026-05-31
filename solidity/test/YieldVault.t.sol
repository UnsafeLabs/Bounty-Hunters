// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/YieldVault.sol";

interface Vm {
    function expectRevert(bytes calldata revertData) external;
    function prank(address msgSender) external;
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

contract YieldVaultTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockERC20 private stakingToken;
    MockERC20 private rewardToken;
    YieldVault private vault;

    function setUp() public {
        vm.warp(1_000);
        stakingToken = new MockERC20("Stake", "STK");
        rewardToken = new MockERC20("Reward", "RWD");
        vault = new YieldVault(address(stakingToken), address(rewardToken));

        stakingToken.mint(address(this), 1_000 ether);
        rewardToken.mint(address(vault), 10_000 ether);
        stakingToken.approve(address(vault), type(uint256).max);
    }

    function testRewardAccruesDuringPeriod() public {
        vault.deposit(100 ether);
        vault.notifyRewardAmount(1_000 ether, 100);

        vm.warp(block.timestamp + 10);

        require(vault.earned(address(this)) == 100 ether, "wrong earned during period");
        require(vault.rewardPerToken() == 1e18, "wrong reward per token");
    }

    function testRewardPerTokenCapsAtPeriodFinish() public {
        vault.deposit(100 ether);
        vault.notifyRewardAmount(1_000 ether, 100);

        vm.warp(block.timestamp + 40);
        require(vault.rewardPerToken() == 4e18, "wrong mid-period reward per token");

        vm.warp(block.timestamp + 1_000);
        require(vault.rewardPerToken() == 10e18, "reward per token should freeze");
    }

    function testEarnedDoesNotIncreaseAfterExpiry() public {
        vault.deposit(100 ether);
        vault.notifyRewardAmount(1_000 ether, 100);

        vm.warp(block.timestamp + 100);
        uint256 earnedAtFinish = vault.earned(address(this));

        vm.warp(block.timestamp + 1_000);
        require(vault.earned(address(this)) == earnedAtFinish, "phantom rewards accrued");
    }

    function testOnlyDistributorCanNotifyRewardAmount() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(bytes("Not distributor"));
        vault.notifyRewardAmount(1_000 ether, 100);
    }

    function testScaledRewardRateKeepsPrecisionLossBelowOneBasisPoint() public {
        stakingToken.mint(address(this), 1);
        vault.deposit(1);
        vault.notifyRewardAmount(1_000_000, 3);

        vm.warp(block.timestamp + 3);

        uint256 earned = vault.earned(address(this));
        uint256 error = 1_000_000 - earned;
        require(error < 100, "precision loss too high");
    }

    function testDepositWithdrawAndClaimStillWork() public {
        vault.deposit(100 ether);
        vault.notifyRewardAmount(1_000 ether, 100);

        vm.warp(block.timestamp + 10);
        vault.claimReward();
        vault.withdraw(100 ether);

        require(rewardToken.balanceOf(address(this)) == 100 ether, "reward not paid");
        require(stakingToken.balanceOf(address(this)) == 1_000 ether, "stake not returned");
        require(vault.totalSupply() == 0, "supply not cleared");
    }
}
