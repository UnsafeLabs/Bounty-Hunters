// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title GovernanceToken — fixed delegation (issue #912)
/// @notice tx.origin replaced with msg.sender so a phishing contract in the
/// middle cannot delegate a victim's votes; only the direct caller delegates
/// its own balance. Admin functions use OpenZeppelin Ownable.
contract GovernanceToken is ERC20, Ownable {
    mapping(address => address) public delegates;
    mapping(address => uint256) public delegatedPower;

    event DelegateChanged(address indexed delegator, address indexed toDelegate);

    constructor() ERC20("GovernanceToken", "GOV") Ownable(msg.sender) {
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }

    function delegateVote(address to) external {
        require(msg.sender != address(0), "Invalid delegator");
        require(to != address(0), "Cannot delegate to zero address");
        require(msg.sender != to, "Cannot delegate to self");
        uint256 bal = balanceOf(msg.sender);
        address prev = delegates[msg.sender];
        if (prev != address(0)) {
            uint256 cur = delegatedPower[prev];
            delegatedPower[prev] = cur >= bal ? cur - bal : 0;
        }
        delegates[msg.sender] = to;
        delegatedPower[to] += bal;
        emit DelegateChanged(msg.sender, to);
    }

    /// @notice Accounts that delegated their own balance away report only the
    /// power delegated TO them, so delegated balances are never double-counted.
    function getVotingPower(address account) public view returns (uint256) {
        if (delegates[account] != address(0)) {
            return delegatedPower[account];
        }
        return balanceOf(account) + delegatedPower[account];
    }

    /// @notice Keeps delegatedPower in sync when a delegator's balance changes
    /// (transfer/mint/burn), so voting weight cannot go stale.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && delegates[from] != address(0)) {
            address d = delegates[from];
            uint256 dec = value > delegatedPower[d] ? delegatedPower[d] : value;
            unchecked {
                delegatedPower[d] -= dec;
            }
        }
        if (to != address(0) && delegates[to] != address(0)) {
            delegatedPower[delegates[to]] += value;
        }
        super._update(from, to, value);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function snapshot() external onlyOwner returns (uint256) {
        return totalSupply();
    }
}
