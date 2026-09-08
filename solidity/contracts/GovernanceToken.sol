// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * @title GovernanceToken
 * @dev ERC20 token with governance capabilities including voting, delegation, and permit
 * @notice Implements ERC20Votes for gas-efficient voting power tracking
 */
contract GovernanceToken is ERC20, ERC20Votes, ERC20Permit, Ownable {
    using SafeMath for uint256;

    uint256 private _nonces;

    string private _name;
    string private _symbol;
    uint8 private _decimals;

    /**
     * @dev Mapping of user addresses to their checkpoints for voting power tracking
     */
    mapping(address => Checkpoints.Checkpoint[]) private _checkpoints;

    /**
     * @dev Mapping of user addresses to their delegation target
     */
    mapping(address => address) private _delegates;

    /**
     * @dev Total checkpoints for voting power tracking
     */
    Checkpoints.Checkpoint[] private _totalCheckpoints;

    /**
     * @dev Struct for checkpoint data
     */
    struct Checkpoint {
        uint256 fromBlock;
        uint256 votes;
    }

    /**
     * @dev Library for managing checkpoints
     */
    library Checkpoints {
        struct Checkpoint {
            uint256 fromBlock;
            uint256 votes;
        }

        struct CheckpointsData {
            Checkpoint[] checkpoints;
        }

        function push(
            storage CheckpointsData storage self,
            uint256 fromBlock,
            uint256 votes
        ) internal {
            self.checkpoints.push(Checkpoint({ fromBlock: fromBlock, votes: votes }));
        }

        function getLast(
            storage CheckpointsData storage self
        ) internal view returns (uint256, uint256) {
            uint256 pos = self.checkpoints.length;
            if (pos == 0) {
                return (0, 0);
            }
            return (
                self.checkpoints[pos - 1].fromBlock,
                self.checkpoints[pos - 1].votes
            );
        }

        function getAtBlock(
            storage CheckpointsData storage self,
            uint256 blockNumber
        ) internal view returns (uint256) {
            uint256 pos = self.checkpoints.length;
            if (pos == 0) {
                return 0;
            }

            // Binary search for the checkpoint
            uint256 lower = 0;
            uint256 upper = pos - 1;
            while (upper > lower) {
                uint256 center = upper - (upper - lower) / 2;
                Checkpoint memory cp = self.checkpoints[center];
                if (cp.fromBlock == blockNumber) {
                    return cp.votes;
                } else if (cp.fromBlock < blockNumber) {
                    lower = center;
                } else {
                    upper = center - 1;
                }
            }
            return self.checkpoints[lower].votes;
        }
    }

    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) ERC20Permit(name) {
        _name = name;
        _symbol = symbol;
        _decimals = 18;
        _nonces = 0;

        // Mint initial supply to owner
        _mint(msg.sender, initialSupply);

        // Initialize checkpoint for owner
        _writeCheckpoint(msg.sender, 0, initialSupply);
        _writeTotalCheckpoint(0, initialSupply);
    }

    /**
     * @dev Returns the name of the token
     */
    function name() public view override returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token
     */
    function symbol() public view override returns (string memory) {
        return _symbol;
    }

    /**
     * @dev Returns the decimals of the token
     */
    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev Returns the version of the token
     */
    function version() public pure returns (string memory) {
        return "1.0.0";
    }

    /**
     * @dev Returns the current votes balance for a user
     * @param user The address to check
     */
    function getVotes(address user) public view returns (uint256) {
        uint256 pos = _checkpoints[user].length;
        return pos == 0 ? 0 : _checkpoints[user][pos - 1].votes;
    }

    /**
     * @dev Returns the votes balance for a user at a specific block
     * @param user The address to check
     * @param blockNumber The block number to check at
     */
    function getPastVotes(address user, uint256 blockNumber)
        public
        view
        returns (uint256)
    {
        uint256 pos = _checkpoints[user].length;
        if (pos == 0) {
            return 0;
        }

        // Binary search for the checkpoint
        uint256 lower = 0;
        uint256 upper = pos - 1;
        while (upper > lower) {
            uint256 center = upper - (upper - lower) / 2;
            Checkpoint memory cp = _checkpoints[user][center];
            if (cp.fromBlock == blockNumber) {
                return cp.votes;
            } else if (cp.fromBlock < blockNumber) {
                lower = center;
            } else {
                upper = center - 1;
            }
        }
        return _checkpoints[user][lower].votes;
    }

    /**
     * @dev Returns the total votes at a specific block
     * @param blockNumber The block number to check at
     */
    function getPastTotalSupply(uint256 blockNumber)
        public
        view
        override
        returns (uint256)
    {
        uint256 pos = _totalCheckpoints.length;
        if (pos == 0) {
            return 0;
        }

        // Binary search for the checkpoint
        uint256 lower = 0;
        uint256 upper = pos - 1;
        while (upper > lower) {
            uint256 center = upper - (upper - lower) / 2;
            Checkpoint memory cp = _totalCheckpoints[center];
            if (cp.fromBlock == blockNumber) {
                return cp.votes;
            } else if (cp.fromBlock < blockNumber) {
                lower = center;
            } else {
                upper = center - 1;
            }
        }
        return _totalCheckpoints[lower].votes;
    }

    /**
     * @dev Returns the current total votes
     */
    function getTotalVotes() public view returns (uint256) {
        uint256 pos = _totalCheckpoints.length;
        return pos == 0 ? 0 : _totalCheckpoints[pos - 1].votes;
    }

    /**
     * @dev Returns the delegate for a user
     * @param delegator The address to check
     */
    function delegates(address delegator) public view returns (address) {
        return _delegates[delegator];
    }

    /**
     * @dev Returns the number of checkpoints for a user
     * @param user The address to check
     */
    function numCheckpoints(address user) public view returns (uint256) {
        return _checkpoints[user].length;
    }

    /**
     * @dev Returns the checkpoint at a specific position for a user
     * @param user The address to check
     * @param pos The position of the checkpoint
     */
    function checkpoints(
        address user,
        uint256 pos
    ) public view returns (uint256 fromBlock, uint256 votes) {
        if (pos >= _checkpoints[user].length) {
            return (0, 0);
        }
        Checkpoint memory cp = _checkpoints[user][pos];
        return (cp.fromBlock, cp.votes);
    }

    /**
     * @dev Delegate votes to another address
     * @param delegatee The address to delegate to
     */
    function delegate(address delegatee) public override {
        _delegate(msg.sender, delegatee);
    }

    /**
     * @dev Internal function to handle delegation
     */
    function _delegate(address delegator, address delegatee) internal {
        address currentDelegate = _delegates[delegator];
        uint256 delegatorBalance = balanceOf(delegator);

        // Remove from current delegate's voting power
        _moveDelegates(currentDelegate, delegatee, delegatorBalance);

        // Update delegate mapping
        _delegates[delegator] = delegatee;

        // Emit event
        emit DelegateChanged(delegator, currentDelegate, delegatee);
    }

    /**
     * @dev Internal function to move delegates between addresses
     */
    function _moveDelegates(
        address from,
        address to,
        uint256 amount
    ) internal {
        if (from != to && amount > 0) {
            // Update voting power
            uint256 fromCheckpoints = _checkpoints[from].length;
            uint256 toCheckpoints = _checkpoints[to].length;

            if (fromCheckpoints > 0) {
                uint256 fromOldVotes = _checkpoints[from][fromCheckpoints - 1].votes;
                uint256 fromNewVotes = fromOldVotes.sub(amount);
                _writeCheckpoint(from, fromCheckpoints, fromNewVotes);
            }

            if (toCheckpoints > 0) {
                uint256 toOldVotes = _checkpoints[to][toCheckpoints - 1].votes;
                uint256 toNewVotes = toOldVotes.add(amount);
                _writeCheckpoint(to, toCheckpoints, toNewVotes);
            }
        }
    }

    /**
     * @dev Internal function to write a checkpoint
     */
    function _writeCheckpoint(
        address user,
        uint256 pos,
        uint256 votes
    ) internal {
        uint256 blockNumber = block.number;

        if (pos == 0) {
            // First checkpoint
            _checkpoints[user].push(
                Checkpoint({ fromBlock: blockNumber, votes: votes })
            );
        } else {
            // Update existing checkpoint
            Checkpoint storage cp = _checkpoints[user][pos - 1];
            if (cp.fromBlock != blockNumber) {
                _checkpoints[user].push(
                    Checkpoint({ fromBlock: blockNumber, votes: votes })
                );
            } else {
                cp.votes = votes;
            }
        }
    }

    /**
     * @dev Internal function to write a total checkpoint
     */
    function _writeTotalCheckpoint(uint256 pos, uint256 votes) internal {
        uint256 blockNumber = block.number;

        if (pos == 0) {
            _totalCheckpoints.push(
                Checkpoint({ fromBlock: blockNumber, votes: votes })
            );
        } else {
            Checkpoint storage cp = _totalCheckpoints[pos - 1];
            if (cp.fromBlock != blockNumber) {
                _totalCheckpoints.push(
                    Checkpoint({ fromBlock: blockNumber, votes: votes })
                );
            } else {
                cp.votes = votes;
            }
        }
    }

    /**
     * @dev Override transfer functions to update checkpoints
     */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20, ERC20Votes) {
        super._afterTokenTransfer(from, to, amount);

        // Update checkpoints for from and to
        uint256 fromCheckpoints = _checkpoints[from].length;
        uint256 toCheckpoints = _checkpoints[to].length;

        if (fromCheckpoints > 0) {
            uint256 fromOldVotes = _checkpoints[from][fromCheckpoints - 1].votes;
            uint256 fromNewVotes = fromOldVotes.sub(amount);
            _writeCheckpoint(from, fromCheckpoints, fromNewVotes);
        }

        if (toCheckpoints > 0) {
            uint256 toOldVotes = _checkpoints[to][toCheckpoints - 1].votes;
            uint256 toNewVotes = toOldVotes.add(amount);
            _writeCheckpoint(to, toCheckpoints, toNewVotes);
        }

        // Update total checkpoints
        uint256 totalCheckpoints = _totalCheckpoints.length;
        if (totalCheckpoints > 0) {
            uint256 totalOldVotes = _totalCheckpoints[totalCheckpoints - 1].votes;
            // Total supply doesn't change on transfer
            _writeTotalCheckpoint(totalCheckpoints, totalOldVotes);
        }
    }

    /**
     * @dev Override mint function to update checkpoints
     */
    function _mint(
        address account,
        uint256 amount
    ) internal override(ERC20, ERC20Votes) {
        super._mint(account, amount);

        // Update checkpoints
        uint256 accountCheckpoints = _checkpoints[account].length;
        if (accountCheckpoints > 0) {
            uint256 accountOldVotes = _checkpoints[account][
                accountCheckpoints - 1
            ].votes;
            uint256 accountNewVotes = accountOldVotes.add(amount);
            _writeCheckpoint(account, accountCheckpoints, accountNewVotes);
        } else {
            _writeCheckpoint(account, 0, amount);
        }

        // Update total checkpoints
        uint256 totalCheckpoints = _totalCheckpoints.length;
        if (totalCheckpoints > 0) {
            uint256 totalOldVotes = _totalCheckpoints[totalCheckpoints - 1].votes;
            uint256 totalNewVotes = totalOldVotes.add(amount);
            _writeTotalCheckpoint(totalCheckpoints, totalNewVotes);
        } else {
            _writeTotalCheckpoint(0, amount);
        }
    }

    /**
     * @dev Override burn function to update checkpoints
     */
    function _burn(
        address account,
        uint256 amount
    ) internal override(ERC20, ERC20Votes) {
        super._burn(account, amount);

        // Update checkpoints
        uint256 accountCheckpoints = _checkpoints[account].length;
        if (accountCheckpoints > 0) {
            uint256 accountOldVotes = _checkpoints[account][
                accountCheckpoints - 1
            ].votes;
            uint256 accountNewVotes = accountOldVotes.sub(amount);
            _writeCheckpoint(account, accountCheckpoints, accountNewVotes);
        }

        // Update total checkpoints
        uint256 totalCheckpoints = _totalCheckpoints.length;
        if (totalCheckpoints > 0) {
            uint256 totalOldVotes = _totalCheckpoints[totalCheckpoints - 1].votes;
            uint256 totalNewVotes = totalOldVotes.sub(amount);
            _writeTotalCheckpoint(totalCheckpoints, totalNewVotes);
        }
    }

    /**
     * @dev Mint new tokens (only callable by owner)
     * @param to The address to mint to
     * @param amount The amount to mint
     */
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    /**
     * @dev Event emitted when a delegate is changed
     */
    event DelegateChanged(
        address indexed delegator,
        address indexed fromDelegate,
        address indexed toDelegate
    );

    /**
     * @dev Event emitted when a delegate votes
     */
    event DelegateVotesChanged(
        address indexed delegate,
        uint256 previousBalance,
        uint256 newBalance
    );
}
