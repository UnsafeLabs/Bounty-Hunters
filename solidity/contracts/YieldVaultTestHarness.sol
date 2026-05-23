// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * YieldVaultTestRunner — stateful test harness with deposit/withdraw/claim flow helper.
 */
contract YieldVaultTestRunner {
    MockERC20 public stakingToken;
    MockERC20 public rewardToken;
    YieldVault public vault;

    uint256 public lastEarned;
    uint256 public lastRewardPerToken;

    constructor() {
        stakingToken = new MockERC20("Stake", "STAKE", 1000000 * 1e18);
        rewardToken = new MockERC20("Reward", "RWD", 1000000 * 1e18);
        vault = new YieldVault(address(stakingToken), address(rewardToken), 7 days);
        rewardToken.mint(address(vault), 10000 * 1e18);
        stakingToken.approve(address(vault), 1000000 * 1e18);
    }

    function deposit(uint256 amount) external { vault.deposit(amount); }
    function withdraw(uint256 amount) external { vault.withdraw(amount); }
    function claimReward() external { vault.claimReward(); }
    function notifyReward(uint256 reward, uint256 duration) external { vault.notifyRewardAmount(reward, duration); }
    function earned(address a) external { lastEarned = vault.earned(a); }
    function rewardPerTokenCheck() external { lastRewardPerToken = vault.rewardPerToken(); }
}

/**
 * UnauthorizedCaller — calls notifyRewardAmount from a non-distributor address.
 * Used to verify access control on YieldVault.notifyRewardAmount.
 */
contract UnauthorizedCaller {
    YieldVault public vault;
    bool public didRevert;

    constructor(address _vault) {
        vault = YieldVault(payable(_vault));
    }

    function tryNotifyReward(uint256 reward, uint256 duration) external {
        try vault.notifyRewardAmount(reward, duration) {
                didRevert = false;
            } catch {
                didRevert = true;
            }
    }
}
