// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/StakingVault.sol";

interface Vm {
    function deal(address account, uint256 amount) external;
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

contract ReentrantAttacker {
    StakingVault private vault;
    MockERC20 private stakingToken;

    bool public attackWithdraw;
    bool public attackClaim;
    bool public attemptedReentry;
    bool public blockedReentry;

    constructor(StakingVault _vault, MockERC20 _stakingToken) {
        vault = _vault;
        stakingToken = _stakingToken;
    }

    function attackWithdrawFlow(uint256 amount) external {
        stakingToken.approve(address(vault), amount);
        vault.stake(amount);
        attackWithdraw = true;
        vault.withdraw(amount);
        attackWithdraw = false;
    }

    function stakeForClaimAttack(uint256 amount) external {
        stakingToken.approve(address(vault), amount);
        vault.stake(amount);
    }

    function attackClaimFlow() external {
        attackClaim = true;
        vault.claimRewards();
        attackClaim = false;
    }

    receive() external payable {
        if (attemptedReentry) return;

        if (attackWithdraw) {
            attemptedReentry = true;
            try vault.withdraw(1) {
                blockedReentry = false;
            } catch {
                blockedReentry = true;
            }
        }

        if (attackClaim) {
            attemptedReentry = true;
            try vault.claimRewards() {
                blockedReentry = false;
            } catch {
                blockedReentry = true;
            }
        }
    }
}

contract StakingVaultTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockERC20 private stakingToken;
    StakingVault private vault;

    function setUp() public {
        vm.warp(1_000);
        vm.deal(address(this), 100 ether);
        stakingToken = new MockERC20("Stake", "STK");
        vault = new StakingVault(address(stakingToken), 1e18);
        (bool success,) = address(vault).call{value: 50 ether}("");
        require(success, "fund vault");
    }

    function testWithdrawReentrancyAttemptIsBlocked() public {
        ReentrantAttacker attacker = new ReentrantAttacker(vault, stakingToken);
        stakingToken.mint(address(attacker), 1 ether);

        attacker.attackWithdrawFlow(1 ether);

        require(attacker.attemptedReentry(), "reentry not attempted");
        require(attacker.blockedReentry(), "reentry not blocked");
        require(vault.getStakedBalance(address(attacker)) == 0, "stake not cleared");
        require(vault.totalStaked() == 0, "total not cleared");
        require(address(vault).balance == 49 ether, "vault drained");
    }

    function testClaimRewardsReentrancyAttemptIsBlocked() public {
        ReentrantAttacker attacker = new ReentrantAttacker(vault, stakingToken);
        stakingToken.mint(address(attacker), 1 ether);

        attacker.stakeForClaimAttack(1 ether);
        vm.warp(block.timestamp + 1);
        attacker.attackClaimFlow();

        require(attacker.attemptedReentry(), "reentry not attempted");
        require(attacker.blockedReentry(), "reentry not blocked");
        require(vault.getPendingRewards(address(attacker)) == 0, "reward not cleared");
        require(address(vault).balance == 49 ether, "vault reward drain");
    }

    function testStakeAndWithdrawFlowStillWorks() public {
        stakingToken.mint(address(this), 2 ether);
        stakingToken.approve(address(vault), 2 ether);

        vault.stake(2 ether);
        vault.withdraw(2 ether);

        require(vault.getStakedBalance(address(this)) == 0, "stake not cleared");
        require(vault.totalStaked() == 0, "total not cleared");
    }

    function testClaimRewardsFlowStillWorks() public {
        stakingToken.mint(address(this), 1 ether);
        stakingToken.approve(address(vault), 1 ether);

        vault.stake(1 ether);
        vm.warp(block.timestamp + 2);
        vault.claimRewards();

        require(vault.getPendingRewards(address(this)) == 0, "reward not cleared");
        require(address(vault).balance == 48 ether, "reward not paid");
    }

    receive() external payable {}
}
