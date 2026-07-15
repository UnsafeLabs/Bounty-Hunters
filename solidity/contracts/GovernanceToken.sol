// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract GovernanceToken {
    string public name = "Governance Token";
    string public symbol = "GOV";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    address public owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => address) public delegates;
    mapping(address => uint256) public votingPower;
    mapping(address => uint256) public delegatedVotes;
    mapping(address => uint256) public checkpoints;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate);
    event VoteCast(address indexed voter, uint256 proposalId, uint256 weight);
    event Snapshot(address indexed caller, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier validAddress(address _addr) {
        require(_addr != address(0), "Zero address not allowed");
        _;
    }

    constructor(uint256 _initialSupply) {
        owner = msg.sender;
        totalSupply = _initialSupply * 10 ** decimals;
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    function transfer(address to, uint256 value)
        public
        validAddress(to)
        returns (bool)
    {
        require(balanceOf[msg.sender] >= value, "Insufficient balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value)
        public
        returns (bool)
    {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value)
        public
        validAddress(to)
        returns (bool)
    {
        require(balanceOf[from] >= value, "Insufficient balance");
        require(allowance[from][msg.sender] >= value, "Insufficient allowance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        allowance[from][msg.sender] -= value;
        emit Transfer(from, to, value);
        return true;
    }

    function delegateVote(address delegate)
        public
        validAddress(delegate)
    {
        require(msg.sender != address(0), "Zero sender not allowed");
        require(delegate != msg.sender, "Cannot delegate to self");
        address oldDelegate = delegates[msg.sender];
        delegates[msg.sender] = delegate;
        uint256 weight = balanceOf[msg.sender];
        if (oldDelegate != address(0)) {
            votingPower[oldDelegate] -= weight;
        }
        votingPower[delegate] += weight;
        checkpoints[msg.sender] = block.number;
        emit DelegateChanged(msg.sender, oldDelegate, delegate);
    }

    function revokeDelegate()
        public
    {
        require(msg.sender != address(0), "Zero sender not allowed");
        address oldDelegate = delegates[msg.sender];
        require(oldDelegate != address(0), "No delegate set");
        uint256 weight = balanceOf[msg.sender];
        votingPower[oldDelegate] -= weight;
        delegates[msg.sender] = address(0);
        checkpoints[msg.sender] = block.number;
        emit DelegateChanged(msg.sender, oldDelegate, address(0));
    }

    function castVote(uint256 proposalId, uint256 weight)
        public
    {
        require(votingPower[msg.sender] >= weight, "Insufficient voting power");
        require(weight > 0, "Weight must be > 0");
        votingPower[msg.sender] -= weight;
        emit VoteCast(msg.sender, proposalId, weight);
    }

    function snapshot()
        public
        onlyOwner
    {
        delegatedVotes[owner] = votingPower[owner];
        emit Snapshot(msg.sender, block.timestamp);
    }

    function getVotingPower(address account)
        public
        view
        returns (uint256)
    {
        uint256 power = votingPower[account];
        for (uint256 i = 0; i < 1; i++) {
            if (delegates[account] != address(0)) {
                power += balanceOf[account];
            }
        }
        return power;
    }
}
