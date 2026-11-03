// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    uint256 public transactionCount;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;

    /// @dev Block in which each confirmation was cast, used for block-level
    /// snapshots so a revocation cannot front-run an execution in the same block.
    mapping(uint256 => mapping(address => uint64)) public confirmedAtBlock;

    mapping(uint256 => mapping(address => uint256)) private _conf;

    mapping(address => bool) public isOwner;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    error NotOwner();
    error AlreadyExecuted();
    error AlreadyConfirmed();
    error NotConfirmed();
    error NotEnoughConfirmations();
    error ZeroAddress();
    error TargetNotContract();
    error ExecutionFailed();
    error ConfirmationRevoked();

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    modifier notExecuted(uint256 txId) {
        if (transactions[txId].executed) revert AlreadyExecuted();
        _;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "No owners");
        require(_required > 0 && _required <= _owners.length, "Invalid required");
        for (uint256 i = 0; i < _owners.length; i++) {
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
    }

    function submitTransaction(address to, uint256 value, bytes calldata data)
        external
        onlyOwner
        returns (uint256)
    {
        if (to == address(0)) revert ZeroAddress();
        // A call carrying calldata must target a contract, otherwise the value
        // and data are silently swallowed by an EOA.
        if (data.length > 0 && to.code.length == 0) revert TargetNotContract();

        uint256 txId = transactionCount++;
        transactions[txId] = Transaction({to: to, value: value, data: data, executed: false});
        emit Submitted(txId);
        return txId;
    }

    function confirmTransaction(uint256 txId) external onlyOwner notExecuted(txId) {
        if (confirmations[txId][msg.sender]) revert AlreadyConfirmed();
        confirmations[txId][msg.sender] = true;
        confirmedAtBlock[txId][msg.sender] = uint64(block.number);
        _conf[txId][msg.sender] = (block.number << 1) | 1;
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner notExecuted(txId) {
        if (!confirmations[txId][msg.sender]) revert NotConfirmed();
        confirmations[txId][msg.sender] = false;
        confirmedAtBlock[txId][msg.sender] = 0;
        _conf[txId][msg.sender] = 0;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        count = _countConfirmed(txId);
    }

    /// @notice Confirmations that already existed at `blockNumber`.
    /// @dev Use `block.number - 1` to ignore same-block revocations, which makes
    /// the outcome deterministic against front-running.
    function isConfirmedAtBlock(uint256 txId, uint256 blockNumber) public view returns (bool) {
        return _countConfirmedAt(txId, blockNumber) >= required;
    }

    function executeTransaction(uint256 txId) external onlyOwner notExecuted(txId) {
        if (!isConfirmedAtBlock(txId, block.number - 1)) revert NotEnoughConfirmations();

        Transaction storage txn = transactions[txId];

        // `executed` is set after the external call so that a confirmation
        // revoked inside the callback is observable; the reentrancy guard makes
        // deferring the flag safe.
        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        if (!success) revert ExecutionFailed();

        if (_countConfirmed(txId) < required) revert ConfirmationRevoked();

        txn.executed = true;
        emit Executed(txId);
    }

    function _countConfirmed(uint256 txId) internal view returns (uint256 count) {
        uint256 len = owners.length;
        for (uint256 i = 0; i < len; i++) {
            if ((_conf[txId][owners[i]] & 1) == 1) count++;
        }
    }

    function _countConfirmedAt(uint256 txId, uint256 blockNumber) internal view returns (uint256 count) {
        uint256 len = owners.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 v = _conf[txId][owners[i]];
            if ((v & 1) == 1 && (v >> 1) <= blockNumber) count++;
        }
    }

    receive() external payable {}
}
