// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract GovernanceToken is ERC20 {
    mapping(address => address) public delegates;
    mapping(address => uint256) public delegatedPower;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // EIP-712 typed delegation
    bytes32 public constant DELEGATION_TYPEHASH =
        keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)");
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");
    mapping(address => uint256) public nonces;

    struct Proposal {
        string description;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 endTime;
        bool executed;
    }

    Proposal[] public proposals;
    address public admin;

    event DelegateChanged(address indexed delegator, address indexed toDelegate);
    event ProposalCreated(uint256 indexed proposalId, string description);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support);

    constructor(uint256 initialSupply) ERC20("Governance", "GOV") {
        _mint(msg.sender, initialSupply);
        admin = msg.sender;
    }

    /// @notice Delegate voting power to another address (called by the delegator directly)
    /// @param to The address to delegate voting power to
    function delegateVote(address to) external {
        require(msg.sender != to, "Cannot delegate to self");
        _delegate(msg.sender, to);
    }

    /// @notice Revoke any active delegation (called by the delegator directly)
    function revokeDelegate() external {
        address currentDelegate = delegates[msg.sender];
        require(currentDelegate != address(0), "No delegate");
        delegatedPower[currentDelegate] -= balanceOf(msg.sender);
        delegates[msg.sender] = address(0);
        emit DelegateChanged(msg.sender, address(0));
    }

    /// @notice Delegate voting power via EIP-712 signed message (gasless delegation)
    /// @param delegatee The address to delegate to
    /// @param nonce The signer's current nonce
    /// @param expiry Timestamp after which the signature is invalid
    /// @param v,r,s ECDSA signature components
    function delegateBySig(
        address delegatee,
        uint256 nonce,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp <= expiry, "Signature expired");
        require(nonce == nonces[msg.sender], "Invalid nonce");

        // EIP-712 domain separator
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256(bytes("Governance")), block.chainid, address(this))
        );

        // Struct hash
        bytes32 structHash = keccak256(abi.encode(DELEGATION_TYPEHASH, delegatee, nonce, expiry));

        // Final hash
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        // Recover signer — the signer is the delegator
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "Invalid signature");
        require(signer != delegatee, "Cannot delegate to self");

        nonces[signer]++;
        _delegate(signer, delegatee);
    }

    /// @notice Admin-only snapshot function
    function snapshot() external {
        require(msg.sender == admin, "Not admin");
        // snapshot logic placeholder
    }

    /// @notice Get the total voting power of an account (own balance + delegated power)
    function getVotingPower(address account) public view returns (uint256) {
        return balanceOf(account) + delegatedPower[account];
    }

    function createProposal(string calldata description, uint256 duration) external returns (uint256) {
        proposals.push(
            Proposal({
                description: description,
                forVotes: 0,
                againstVotes: 0,
                endTime: block.timestamp + duration,
                executed: false
            })
        );
        uint256 proposalId = proposals.length - 1;
        emit ProposalCreated(proposalId, description);
        return proposalId;
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp < proposal.endTime, "Voting ended");
        require(!hasVoted[proposalId][msg.sender], "Already voted");

        uint256 power = getVotingPower(msg.sender);
        require(power > 0, "No voting power");

        hasVoted[proposalId][msg.sender] = true;
        if (support) {
            proposal.forVotes += power;
        } else {
            proposal.againstVotes += power;
        }
        emit VoteCast(proposalId, msg.sender, support);
    }

    /// @dev Internal delegation logic shared by delegateVote and delegateBySig
    function _delegate(address delegator, address to) internal {
        address previousDelegate = delegates[delegator];
        if (previousDelegate != address(0)) {
            delegatedPower[previousDelegate] -= balanceOf(delegator);
        }
        delegates[delegator] = to;
        delegatedPower[to] += balanceOf(delegator);
        emit DelegateChanged(delegator, to);
    }
}
