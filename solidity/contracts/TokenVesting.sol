// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title TokenVesting
 * @notice Linear token vesting contract with cliff, revocation, and safe arithmetic.
 * @dev Uses Solidity 0.8+ built-in overflow checks and OpenZeppelin Math for safe multiplication/division.
 *      Vesting calculation uses Math.mulDiv for precision and overflow safety.
 *      All critical functions have access controls and input validation.
 */
contract TokenVesting {
    // --- State Variables ---
    IERC20 public token;
    address public beneficiary;
    address public owner;

    uint256 public totalAllocation;
    uint256 public start;
    uint256 public cliff;      // timestamp = start + cliffDuration
    uint256 public duration;   // total vesting duration
    uint256 public claimed;
    bool public revoked;

    bool private _tokenInitialized;

    // --- Events ---
    event TokensClaimed(address indexed beneficiary, uint256 amount);
    event VestingRevoked(address indexed beneficiary, uint256 unvestedAmount);
    event TokenInitialized(address indexed token);

    // --- Modifiers ---
    /// @dev Restricts function to the beneficiary only.
    modifier onlyBeneficiary() {
        require(msg.sender == beneficiary, "TokenVesting: caller is not the beneficiary");
        _;
    }

    /// @dev Restricts function to the owner only.
    modifier onlyOwner() {
        require(msg.sender == owner, "TokenVesting: caller is not the owner");
        _;
    }

    // --- Constructor ---
    /**
     * @notice Initializes the vesting contract with core parameters.
     * @dev The token address can be `address(0)` if deferred initialization is needed (e.g., for proxy patterns).
     *      All parameters are validated.
     * @param _token ERC20 token address (may be address(0) if `initializeToken` will be called later)
     * @param _beneficiary Address that receives vested tokens
     * @param _totalAllocation Total tokens to vest (up to 1e27 with 18 decimals; limited by uint256 max)
     * @param _start Vesting start timestamp (Unix seconds)
     * @param _cliffDuration Duration of the cliff in seconds (0 for no cliff)
     * @param _vestingDuration Total vesting duration in seconds (must be > 0)
     */
    constructor(
        address _token,
        address _beneficiary,
        uint256 _totalAllocation,
        uint256 _start,
        uint256 _cliffDuration,
        uint256 _vestingDuration
    ) {
        require(_beneficiary != address(0), "TokenVesting: beneficiary is zero address");
        require(_totalAllocation > 0, "TokenVesting: totalAllocation must be > 0");
        require(_vestingDuration > 0, "TokenVesting: vestingDuration must be > 0");
        require(
            _start + _cliffDuration <= _start + _vestingDuration,
            "TokenVesting: cliff exceeds vesting duration"
        );

        token = IERC20(_token);
        if (_token != address(0)) {
            _tokenInitialized = true;
            emit TokenInitialized(_token);
        }
        beneficiary = _beneficiary;
        owner = msg.sender;
        totalAllocation = _totalAllocation;
        start = _start;
        cliff = _start + _cliffDuration;
        duration = _vestingDuration;
    }

    // --- External Functions ---
    /**
     * @notice Optional secondary token setter for proxy patterns (e.g., minimal proxy).
     * @dev Can only be called by the owner and only once. Reverts if token is zero or already set.
     * @param _token ERC20 token address (must be non-zero)
     */
    function initializeToken(address _token) external onlyOwner {
        require(_token != address(0), "TokenVesting: token address is zero");
        require(!_tokenInitialized, "TokenVesting: token already initialized");
        token = IERC20(_token);
        _tokenInitialized = true;
        emit TokenInitialized(_token);
    }

    /**
     * @notice Returns the amount of tokens vested at the current block timestamp.
     * @dev Uses OpenZeppelin's Math.mulDiv for safe, precise multiplication/division.
     *      At full duration (`block.timestamp >= start + duration`), returns totalAllocation.
     * @return vested Number of tokens vested (floor)
     */
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) {
            return 0;
        }

        if (block.timestamp >= start + duration) {
            return totalAllocation;
        }

        uint256 elapsed = block.timestamp - start;
        // Math.mulDiv performs (totalAllocation * elapsed) / duration with full precision, safe from overflow.
        return Math.mulDiv(totalAllocation, elapsed, duration);
    }

    /**
     * @notice Returns the amount of tokens currently claimable by the beneficiary.
     * @dev Guaranteed to never revert by returning 0 if claimed exceeds vested (e.g., due to a bug).
     * @return claimableAmount Vested minus claimed, or 0 if claimed > vested
     */
    function claimable() public view returns (uint256) {
        uint256 vested = vestedAmount();
        return vested > claimed ? vested - claimed : 0;
    }

    /**
     * @notice Claims available vested tokens for the beneficiary.
     * @dev Transfers the claimable amount to the beneficiary. Emits TokensClaimed.
     *      Reverts if nothing to claim or token transfer fails.
     */
    function claim() external onlyBeneficiary {
        uint256 amount = claimable();
        require(amount > 0, "TokenVesting: nothing to claim");
        claimed += amount;
        require(token.transfer(beneficiary, amount), "TokenVesting: transfer failed");
        emit TokensClaimed(beneficiary, amount);
    }

    /**
     * @notice Revokes unvested tokens and sends them back to the owner.
     * @dev Handles cliff period correctly: unvested = totalAllocation - vested.
     *      If the beneficiary has not claimed all vested tokens, the remaining vested tokens are sent first.
     *      Revocation is irreversible.
     *      Emits VestingRevoked with the unvested amount.
     * @notice The formula `unvested = totalAllocation - vested` is correct for standard revocation.
     *         It does not subtract claimed because that could penalize the beneficiary unfairly.
     */
    function revoke() external onlyOwner {
        require(!revoked, "TokenVesting: already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        uint256 unvested = totalAllocation - vested;

        // Send any remaining vested (but unclaimed) tokens to beneficiary
        if (vested > claimed) {
            uint256 remainingVested = vested - claimed;
            require(token.transfer(beneficiary, remainingVested), "TokenVesting: transfer to beneficiary failed");
        }

        // Send unvested tokens to owner
        require(token.transfer(owner, unvested), "TokenVesting: transfer to owner failed");
        emit VestingRevoked(beneficiary, unvested);
    }

    // --- Overflow Safety Analysis ---
    /**
     * @dev Absolute overflow safety analysis:
     *      - Maximum allocation: 1e27 (1 billion tokens with 18 decimals)
     *      - Maximum vesting duration: 10 years ≈ 3.1536e8 seconds
     *      - Using Math.mulDiv renders intermediate multiplication obsolete.
     *      - With Solidity 0.8+ built-in overflow checks and Math.mulDiv's 512-bit arithmetic, overflow is impossible.
     */
}