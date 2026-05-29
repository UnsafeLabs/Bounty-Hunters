// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TokenVesting {
    IERC20 public token;
    address public beneficiary;
    address public owner;

    uint256 public totalAllocation;
    uint256 public start;
    uint256 public cliff;
    uint256 public duration;
    uint256 public claimed;
    bool public revoked;

    event TokensClaimed(address indexed beneficiary, uint256 amount);
    event VestingRevoked(address indexed beneficiary, uint256 unvested);

    constructor(
        address _token,
        address _beneficiary,
        uint256 _totalAllocation,
        uint256 _start,
        uint256 _cliffDuration,
        uint256 _vestingDuration
    ) {
        token = IERC20(_token);
        beneficiary = _beneficiary;
        owner = msg.sender;
        totalAllocation = _totalAllocation;
        start = _start;
        cliff = _start + _cliffDuration;
        duration = _vestingDuration;
    }

    // BUG: Overflow risk for large allocations — totalAllocation * elapsed can exceed uint256
    function vestedAmount() public view returns (uint256) {
        if (block.timestamp < cliff) return 0;
        if (block.timestamp >= start + duration) return totalAllocation;

        uint256 elapsed = block.timestamp - start;
        // This multiplication can overflow for large totalAllocation values
        return totalAllocation * elapsed / duration;
    }

    function claimable() public view returns (uint256) {
        return vestedAmount() - claimed;
    }

    function claim() external {
        require(msg.sender == beneficiary, "Not beneficiary");
        uint256 amount = claimable();
        require(amount > 0, "Nothing to claim");
        claimed += amount;
        token.transfer(beneficiary, amount);
        emit TokensClaimed(beneficiary, amount);
    }

    // BUG: Incorrect unvested calculation during cliff period
    function revoke() external {
        require(msg.sender == owner, "Not owner");
        require(!revoked, "Already revoked");
        revoked = true;

        uint256 vested = vestedAmount();
        // BUG: Should be totalAllocation - claimed, not totalAllocation - vested
        // during cliff, vested is 0 but user may have claimed nothing
        uint256 unvested = totalAllocation - vested;

        if (vested > claimed) {
            token.transfer(beneficiary, vested - claimed);
        }
        token.transfer(owner, unvested);
        emit VestingRevoked(beneficiary, unvested);
    }
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TokenVesting {
    using SafeERC20 for IERC20;

    event TokensReleased(address token, uint256 amount);
    event TokenVestingRevoked(address token, uint256 amount);

    // beneficiary of the vesting schedule
    address private _beneficiary;

    // vesting schedule
    uint256 private _start;
    uint256 private _duration;
    uint256 private _cliff;
    uint256 private _totalAllocation;
    bool private _revoked;

    constructor(address beneficiary, uint256 start, uint256 duration, uint256 cliff, uint256 totalAllocation) {
        _beneficiary = beneficiary;
        _start = start;
        _duration = duration;
        _cliff = cliff;
        _totalAllocation = totalAllocation;
        _revoked = false;
    }

    function vestedAmount(address token) public view returns (uint256) {
        // Implementation would go here in a real contract
        return 0;
    }

    function release(address token) public {
        // Release implementation would go here
    }

    function revoke(address token) public {
        // Revoke implementation would go here
    }

    function getBeneficiary() public view returns (address) {
        return _beneficiary;
    }

    function getStart() public view returns (uint256) {
        return _start;
    }

    function getDuration() public view returns (uint256) {
        return _duration;
    }

    function getCliff() public view returns (uint256) {
        return _cliff;
    }

    function getTotalAllocation() public view returns (uint256) {
        return _totalAllocation;
    }

    function isRevoked() public view returns (bool) {
        return _revoked;
    }
}
}
