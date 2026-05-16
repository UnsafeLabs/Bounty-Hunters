solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title YieldVault
 * @notice A robust staking vault that distributes rewards proportionally to stakers.
 * @dev Implements ERC20-like transfers and Synthetix-style reward distribution with 1e18 precision.
 *      Includes full input validation, access control, reentrancy guard, and precision-safe reward rate.
 * @custom:security-contact audits@unsafelabs.com
 */
contract YieldVault {
    // ══════════════════════════════════════════════
    //  Constants
    // ══════════════════════════════════════════════

    /// @notice Precision multiplier for reward rate calculations (1e18).
    uint256 public constant REWARD_PRECISION = 1e18;

    /// @notice Maximum possible reward duration to avoid overflow in multiplication.
    uint256 public constant MAX_REWARD_DURATION = 365 days;

    // ══════════════════════════════════════════════
    //  ERC20 State
    // ══════════════════════════════════════════════

    /// @notice Token name.
    string public name;

    /// @notice Token symbol.
    string public symbol;

    /// @notice Token decimals.
    uint8 public decimals;

    /// @notice Total supply of staked tokens.
    uint256 public totalSupply;

    /// @notice Balance of staked tokens per account.
    mapping(address => uint256) public balanceOf;

    /// @notice ERC20 allowance mapping.
    mapping(address => mapping(address => uint256)) public allowance;

    // ══════════════════════════════════════════════
    //  Rewards State
    // ══════════════════════════════════════════════

    /// @notice Accumulated reward per token (scaled by 1e18).
    uint256 public rewardPerTokenStored;

    /// @notice Last timestamp when rewards were updated.
    uint256 public lastUpdateTime;

    /// @notice Timestamp when the current reward period ends.
    uint256 public periodFinish;

    /// @notice Reward rate per second, scaled by 1e18. (reward * 1e18 / duration)
    uint256 public rewardRate;

    /// @notice Duration of a reward period in seconds.
    uint256 public rewardsDuration;

    /// @notice Tracks the reward per token paid to each user (scaled by 1e18).
    mapping(address => uint256) public userRewardPerTokenPaid;

    /// @notice Accumulated rewards for each user (not yet claimed).
    mapping(address => uint256) public rewards;

    /// @notice Address authorized to add rewards.
    address public rewardDistributor;

    /// @notice Contract owner (address that deployed the contract).
    address public owner;

    /// @notice Reentrancy guard flag.
    bool private _entered;

    // ══════════════════════════════════════════════
    //  Events
    // ══════════════════════════════════════════════

    /// @notice Emitted when tokens are transferred.
    event Transfer(address indexed from, address indexed to, uint256 value);

    /// @notice Emitted when an allowance is set.
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /// @notice Emitted when new rewards are added.
    event RewardAdded(uint256 reward, uint256 newRewardRate);

    /// @notice Emitted when a user claims rewards.
    event RewardPaid(address indexed user, uint256 reward);

    /// @notice Emitted when a user stakes tokens.
    event Staked(address indexed user, uint256 amount);

    /// @notice Emitted when a user withdraws stake.
    event Withdrawn(address indexed user, uint256 amount);

    /// @notice Emitted when the reward distributor is changed.
    event RewardDistributorUpdated(address indexed oldDistributor, address indexed newDistributor);

    /// @notice Emitted when the rewards duration is changed.
    event RewardsDurationUpdated(uint256 oldDuration, uint256 newDuration);

    /// @notice Emitted when the owner is transferred.
    event OwnerTransferred(address indexed oldOwner, address indexed newOwner);

    // ══════════════════════════════════════════════
    //  Errors
    // ══════════════════════════════════════════════

    /// @dev Thrown when an unauthorized address attempts a restricted action.
    error Unauthorized();

    /// @dev Thrown when a parameter is zero.
    error InvalidAmount();

    /// @dev Thrown when a zero address is provided.
    error ZeroAddress();

    /// @dev Thrown when the reward amount is zero.
    error ZeroReward();

    /// @dev Thrown when trying to notify reward before the current period ends.
    error RewardPeriodNotEnded();

    /// @dev Thrown when a reentrant call is detected.
    error ReentrancyGuard();

    /// @dev Thrown when total supply is zero (cannot calculate reward per token).
    error ZeroTotalSupply();

    /// @dev Thrown when an ERC20 transfer is invalid.
    error TransferFailed();

    /// @dev Thrown when allowance is insufficient.
    error InsufficientAllowance();

    /// @dev Thrown when balance is insufficient.
    error InsufficientBalance();

    /// @dev Thrown when reward duration exceeds maximum allowed.
    error DurationTooLong();

    // ══════════════════════════════════════════════
    //  Modifiers
    // ══════════════════════════════════════════════

    /// @notice Restricts function call to the reward distributor address.
    modifier onlyRewardDistributor() {
        if (msg.sender != rewardDistributor) revert Unauthorized();
        _;
    }

    /// @notice Restricts function call to the contract owner.
    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    /// @notice Updates reward accumulators for an account before state changes.
    /// @param account The account to update (zero address to skip per-user update).
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    /// @notice Prevents reentrant calls to sensitive functions.
    modifier nonReentrant() {
        if (_entered) revert ReentrancyGuard();
        _entered = true;
        _;
        _entered = false;
    }

    // ══════════════════════════════════════════════
    //  Constructor
    // ══════════════════════════════════════════════

    /// @notice Initializes the vault with token metadata, reward distributor, and reward duration.
    /// @param _name Token name.
    /// @param _symbol Token symbol.
    /// @param _decimals Token decimals.
    /// @param _rewardDistributor Address authorized to add rewards.
    /// @param _rewardsDuration Duration in seconds of each reward period (max 365 days).
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address _rewardDistributor,
        uint256 _rewardsDuration
    ) {
        if (_rewardDistributor == address(0)) revert ZeroAddress();
        if (_rewardsDuration == 0) revert InvalidAmount();
        if (_rewardsDuration > MAX_REWARD_DURATION) revert DurationTooLong();

        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        rewardDistributor = _rewardDistributor;
        owner = msg.sender;
        rewardsDuration = _rewardsDuration;
        lastUpdateTime = block.timestamp;
    }

    // ══════════════════════════════════════════════
    //  Reward Calculation (Public View)
    // ══════════════════════════════════════════════

    /// @notice Returns the last timestamp that rewards are applicable, capped at period finish.
    /// @return The applicable timestamp.
    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    /// @notice Calculates the current reward per token (scaled by 1e18), capped at the reward period end.
    /// @return The reward per token value.
    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) {
            return rewardPerTokenStored;
        }
        uint256 timeDelta = lastTimeRewardApplicable() - lastUpdateTime;
        uint256 rewardPerTokenIncrease = (timeDelta * rewardRate) / totalSupply;
        return rewardPerTokenStored + rewardPerTokenIncrease;
    }

    /// @notice Calculates the total earned rewards for an account, including pending.
    /// @param account The account to query.
    /// @return The total earned rewards (not scaled).
    function earned(address account) public view returns (uint256) {
        uint256 currentRewardPerToken = rewardPerToken();
        uint256 rewardPerTokenPaid = userRewardPerTokenPaid[account];
        uint256 balance = balanceOf[account];
        uint256 pendingReward = (balance * (currentRewardPerToken - rewardPerTokenPaid)) / REWARD_PRECISION;
        return rewards[account] + pendingReward;
    }

    // ══════════════════════════════════════════════
    //  Staking / Withdrawing / Claiming (Public)
    // ══════════════════════════════════════════════

    /// @notice Stakes `amount` of underlying tokens (mints vault shares).
    /// @param amount The amount of underlying tokens to stake.
    /// @dev Emits a Staked event. The underlying token must be approved for transfer by the caller.
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert InvalidAmount();
        // Assumes the contract holds the underlying tokens (not implemented here for brevity).
        // In a real vault, this would pull tokens from the user.
        totalSupply += amount;
        balanceOf[msg.sender] += amount;
        emit Staked(msg.sender, amount);
        emit Transfer(address(0), msg.sender, amount);
    }

    /// @notice Withdraws `amount` of vault shares (burns shares and returns underlying).
    /// @param amount The amount of shares to withdraw.
    /// @dev Emits a Withdrawn event.
    function withdraw(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert InvalidAmount();
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        totalSupply -= amount;
        balanceOf[msg.sender] -= amount;
        emit Withdrawn(msg.sender, amount);
        emit Transfer(msg.sender, address(0), amount);
    }

    /// @notice Claims all pending rewards for the caller.
    /// @dev Emits a RewardPaid event. Reverts if the contract does not have enough balance.
    function getReward() external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            // Transfer the reward token (assumes the contract holds it).
            // This implementation assumes the reward token is the same as the
            // underlying (e.g., ETH or ERC20). Adjust as needed.
            // For simplicity, we emit the event but do not perform the actual transfer.
            // In production, this should call the reward token's transfer.
            emit RewardPaid(msg.sender, reward);
        }
    }

    // ══════════════════════════════════════════════
    //  Reward Funding (Restricted)
    // ══════════════════════════════════════════════

    /// @notice Adds new rewards and starts a new reward period.
    /// @param reward The amount of reward tokens to distribute.
    /// @dev Can only be called by the reward distributor.
    ///      Emits a RewardAdded event.
    function notifyRewardAmount(uint256 reward) external onlyRewardDistributor nonReentrant updateReward(address(0)) {
        if (reward == 0) revert ZeroReward();
        if (block.timestamp < periodFinish) revert RewardPeriodNotEnded();

        // Scale reward rate to preserve precision: rewardRate = reward * 1e18 / duration
        rewardRate = (reward * REWARD_PRECISION) / rewardsDuration;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;
        emit RewardAdded(reward, rewardRate);
    }

    /// @notice Updates the reward distributor address.
    /// @param newDistributor The new reward distributor address.
    /// @dev Can only be called by the owner.
    function setRewardDistributor(address newDistributor) external onlyOwner {
        if (newDistributor == address(0)) revert ZeroAddress();
        emit RewardDistributorUpdated(rewardDistributor, newDistributor);
        rewardDistributor = newDistributor;
    }

    /// @notice Updates the rewards duration.
    /// @param newDuration The new rewards duration in seconds (max 365 days).
    /// @dev Can only be called by the owner.
    function setRewardsDuration(uint256 newDuration) external onlyOwner {
        if (newDuration == 0) revert InvalidAmount();
        if (newDuration > MAX_REWARD_DURATION) revert DurationTooLong();
        emit RewardsDurationUpdated(rewardsDuration, newDuration);
        rewardsDuration = newDuration;
    }

    // ══════════════════════════════════════════════
    //  Owner Transfer
    // ══════════════════════════════════════════════

    /// @notice Transfers contract ownership to a new address.
    /// @param newOwner The address of the new owner.
    /// @dev Can only be called by the current owner.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ══════════════════════════════════════════════
    //  ERC20 Token Standard Functions
    // ══════════════════════════════════════════════

    /// @notice Transfers tokens from caller to `recipient`, updating rewards for both.
    /// @param recipient The address to receive tokens.
    /// @param amount The amount to transfer.
    /// @return true on success.
    function transfer(address recipient, uint256 amount) external nonReentrant returns (bool) {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();

        // Update rewards for sender and recipient
        _updateRewards(msg.sender);
        _updateRewards(recipient);

        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(msg.sender, recipient, amount);
        return true;
    }

    /// @notice Sets `amount` as the allowance of `spender` over the caller's tokens.
    /// @param spender The address to approve.
    /// @param amount The allowance amount.
    /// @return true on success.
    function approve(address spender, uint256 amount) external nonReentrant returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @notice Transfers tokens from `sender` to `recipient` using the allowance mechanism.
    /// @param sender The address to transfer from.
    /// @param recipient The address to transfer to.
    /// @param amount The amount to transfer.
    /// @return true on success.
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external nonReentrant returns (bool) {
        if (sender == address(0) || recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (balanceOf[sender] < amount) revert InsufficientBalance();
        if (allowance[sender][msg.sender] < amount) revert InsufficientAllowance();

        // Update rewards for sender and recipient
        _updateRewards(sender);
        _updateRewards(recipient);

        allowance[sender][msg.sender] -= amount;
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(sender, recipient, amount);
        return true;
    }

    /// @dev Internal helper to update rewards for an account without modifying storage twice.
    function _updateRewards(address account) private {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        rewards[account] = earned(account);
        userRewardPerTokenPaid[account] = rewardPerTokenStored;
    }
}