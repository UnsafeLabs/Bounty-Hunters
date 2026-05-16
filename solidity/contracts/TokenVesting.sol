solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice This contract uses Solidity ^0.8.19 built‑in overflow/underflow checks for all
/// arithmetic operations. No SafeMath library is needed as the compiler automatically reverts
/// on overflow.

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// ──────────────────────────────────────────────────────────────
//  Custom errors
// ──────────────────────────────────────────────────────────────
error TokenVesting__ZeroAddress();
error TokenVesting__ZeroAllocation();
error TokenVesting__ZeroDuration();
error TokenVesting__CliffExceedsDuration();
error TokenVesting__InsufficientBalance();
error TokenVesting__NoTokensDue();
error TokenVesting__TransferFailed();
error TokenVesting__NoUnvestedTokens();
error TokenVesting__CallerNotBeneficiary();
error TokenVesting__AlreadyRevoked();

/**
 * @title TokenVesting
 * @notice Linear token vesting contract with cliff and revocation support.
 * @dev Uses Solidity 0.8 built‑in arithmetic overflow protection.
 *      Vesting calculation uses division‑first to avoid intermediate overflow
 *      for allocations up to 1e27 (1e9 tokens with 18 decimals).
 *      Remainder handling ensures total claimed equals total allocation at vesting end.
 *      Revocation correctly computes unvested tokens both during and after the cliff,
 *      and can be executed only once. The beneficiary retains the right to claim all
 *      vested tokens even after revocation.
 *      Release is restricted to the beneficiary.
 */
contract TokenVesting is Ownable {
    // ────────────────────────────────────────────────────────────
    //  Immutable state
    // ────────────────────────────────────────────────────────────
    IERC20 public immutable token;
    address public immutable beneficiary;
    uint256 public immutable totalAllocation;
    uint256 public immutable start;
    uint256 public immutable duration;
    uint256 public immutable cliff;

    // ────────────────────────────────────────────────────────────
    //  Mutable state
    // ────────────────────────────────────────────────────────────
    /// @notice Amount of tokens already released to the beneficiary.
    uint256 public released;

    /// @notice Whether the vesting schedule has been revoked by the owner.
    bool public revoked;

    // ────────────────────────────────────────────────────────────
    //  Events
    // ────────────────────────────────────────────────────────────
    /// @notice Emitted when the beneficiary claims vested tokens.
    event TokensReleased(address indexed beneficiary, uint256 amount);

    /// @notice Emitted when the owner revokes unvested tokens.
    event TokensRevoked(address indexed beneficiary, uint256 unvestedAmount);

    // ────────────────────────────────────────────────────────────
    //  Modifier
    // ────────────────────────────────────────────────────────────
    /// @dev Reverts if the caller is not the beneficiary.
    modifier onlyBeneficiary() {
        if (msg.sender != beneficiary) revert TokenVesting__CallerNotBeneficiary();
        _;
    }

    // ────────────────────────────────────────────────────────────
    //  Constructor
    // ────────────────────────────────────────────────────────────
    /**
     * @notice Sets up the vesting schedule.
     * @dev The deployer must first transfer the `_totalAllocation` tokens to this contract.
     * @param _token              ERC20 token address
     * @param _beneficiary        Address that receives vested tokens
     * @param _totalAllocation    Total token amount to vest (in token decimals)
     * @param _start              Vesting start timestamp (seconds)
     * @param _duration           Vesting duration (seconds)
     * @param _cliff              Cliff duration from start (seconds)
     */
    constructor(
        address _token,
        address _beneficiary,
        uint256 _totalAllocation,
        uint256 _start,
        uint256 _duration,
        uint256 _cliff
    ) Ownable(msg.sender) {
        // ── Input validation ──
        if (_token == address(0)) revert TokenVesting__ZeroAddress();
        if (_beneficiary == address(0)) revert TokenVesting__ZeroAddress();
        if (_totalAllocation == 0) revert TokenVesting__ZeroAllocation();
        if (_duration == 0) revert TokenVesting__ZeroDuration();
        if (_cliff > _duration) revert TokenVesting__CliffExceedsDuration();

        // Ensure the contract already holds the full allocation.
        if (IERC20(_token).balanceOf(address(this)) < _totalAllocation) {
            revert TokenVesting__InsufficientBalance();
        }

        token = IERC20(_token);
        beneficiary = _beneficiary;
        totalAllocation = _totalAllocation;
        start = _start;
        duration = _duration;
        cliff = _cliff;

        // Revocation is allowed initially.
        revoked = false;
    }

    // ────────────────────────────────────────────────────────────
    //  Public view functions
    // ────────────────────────────────────────────────────────────

    /**
     * @notice Returns the cumulative vested amount up to the current block timestamp.
     * @dev Uses division‑first to avoid intermediate overflow:
     *      `base = (totalAllocation / duration) * elapsed`
     *      + `remainder = (totalAllocation % duration) * elapsed / duration`
     *      At full duration, returns `totalAllocation`.
     * @return uint256 Vested amount (with remainder handling ensures accuracy within 1 wei)
     */
    function vestedAmount() public view returns (uint256) {
        // Before cliff – no tokens vested.
        if (block.timestamp < start + cliff) {
            return 0;
        }
        // After full duration – all tokens vested.
        if (block.timestamp >= start + duration) {
            return totalAllocation;
        }

        uint256 elapsed = block.timestamp - start;

        // Division‑first: split into whole and fractional parts to avoid overflow.
        uint256 base = (totalAllocation / duration) * elapsed;
        uint256 remainder = (totalAllocation % duration) * elapsed / duration;

        return base + remainder;
    }

    /**
     * @notice Returns the amount of vested but not yet released tokens.
     * @return uint256 Releasable amount (vested minus released).
     */
    function releasable() public view returns (uint256) {
        return vestedAmount() - released;
    }

    // ────────────────────────────────────────────────────────────
    //  Mutative functions
    // ────────────────────────────────────────────────────────────

    /**
     * @notice Beneficiary claims all currently releasable tokens.
     * @dev Restricted to the beneficiary. Reverts if no tokens are due.
     *      Uses checks‑effects‑interactions pattern to prevent re‑entrancy.
     *      Emits {TokensReleased}.
     */
    function release() external onlyBeneficiary {
        uint256 amount = releasable();
        if (amount == 0) revert TokenVesting__NoTokensDue();

        // Update state before transfer (checks‑effects‑interactions).
        released += amount;

        // Perform the external transfer.
        if (!token.transfer(beneficiary, amount)) {
            revert TokenVesting__TransferFailed();
        }
        emit TokensReleased(beneficiary, amount);
    }

    /**
     * @notice Owner revokes all unvested tokens, returning them to the owner.
     * @dev Can only be executed once. During the cliff period (no tokens vested),
     *      unvested = totalAllocation - released.
     *      After cliff, unvested = totalAllocation - vestedAmount().
     *      The beneficiary keeps all vested tokens (including those not yet claimed).
     *      Reverts if the contract balance is insufficient (should never happen).
     *      Emits {TokensRevoked}.
     */
    function revoke() external onlyOwner {
        // Prevent multiple revocations.
        if (revoked) revert TokenVesting__AlreadyRevoked();
        revoked = true;

        uint256 unvested;
        if (block.timestamp < start + cliff) {
            // Cliff period – no tokens vested.
            unvested = totalAllocation - released;
        } else {
            // Post‑cliff: unvested = total - vested (which never underflows).
            unvested = totalAllocation - vestedAmount();
        }

        if (unvested == 0) revert TokenVesting__NoUnvestedTokens();

        // Safety check: ensure the contract holds enough tokens to revoke the full amount.
        // This should always hold, but we check to avoid locked tokens due to external transfers.
        if (token.balanceOf(address(this)) < unvested) {
            revert TokenVesting__InsufficientBalance();
        }

        // Transfer unvested tokens to the owner.
        if (!token.transfer(owner(), unvested)) {
            revert TokenVesting__TransferFailed();
        }
        emit TokensRevoked(beneficiary, unvested);
    }
}