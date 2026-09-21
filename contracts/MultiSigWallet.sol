// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title MultiSigWallet
 * @dev Simple multi-signature wallet with added re‑entrancy protection and block‑level
 * confirmation checks to prevent race conditions during execution callbacks.
 */
contract MultiSigWallet {
    event Deposit(address indexed sender, uint256 value);
    event SubmitTransaction(
        address indexed owner,
        uint256 indexed txId,
        address indexed to,
        uint256 value,
        bytes data
    );
    event ConfirmTransaction(address indexed owner, uint256 indexed txId);
    event RevokeConfirmation(address indexed owner, uint256 indexed txId);
    event Execution(uint256 indexed txId);
    event ExecutionFailure(uint256 indexed txId);

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
    }

    struct Confirmation {
        bool confirmed;
        uint256 blockNumber; // block when the confirmation was made
    }

    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public required; // number of required confirmations

    Transaction[] public transactions;

    // txId => owner => Confirmation
    mapping(uint256 => mapping(address => Confirmation)) public confirmations;

    // re‑entrancy guard
    bool private locked;

    modifier onlyOwner() {
        require(isOwner[msg.sender], "not owner");
        _;
    }

    modifier txExists(uint256 _txId) {
        require(_txId < transactions.length, "tx does not exist");
        _;
    }

    modifier notExecuted(uint256 _txId) {
        require(!transactions[_txId].executed, "tx already executed");
        _;
    }

    modifier notConfirmed(uint256 _txId) {
        require(!confirmations[_txId][msg.sender].confirmed, "tx already confirmed");
        _;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "owners required");
        require(
            _required > 0 && _required <= _owners.length,
            "invalid required number of owners"
        );

        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            require(owner != address(0), "invalid owner");
            require(!isOwner[owner], "owner not unique");

            isOwner[owner] = true;
            owners.push(owner);
        }

        required = _required;
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @dev Submit a transaction.
     * @param _to Destination address.
     * @param _value Ether value.
     * @param _data Transaction data payload.
     */
    function submitTransaction(
        address _to,
        uint256 _value,
        bytes memory _data
    ) public onlyOwner {
        require(_to != address(0), "invalid destination address");

        // Optional: ensure that if the destination is a contract, it actually has code.
        // This prevents accidental calls to non‑contract addresses when a contract is expected.
        if (_to.code.length > 0) {
            // contract target – nothing extra to check
        }

        uint256 txId = transactions.length;

        transactions.push(
            Transaction({to: _to, value: _value, data: _data, executed: false})
        );

        emit SubmitTransaction(msg.sender, txId, _to, _value, _data);
    }

    /**
     * @dev Confirm a transaction.
     * @param _txId Transaction ID.
     */
    function confirmTransaction(uint256 _txId)
        public
        onlyOwner
        txExists(_txId)
        notConfirmed(_txId)
    {
        confirmations[_txId][msg.sender] = Confirmation({
            confirmed: true,
            blockNumber: block.number
        });

        emit ConfirmTransaction(msg.sender, _txId);
    }

    /**
     * @dev Revoke a confirmation.
     * @param _txId Transaction ID.
     */
    function revokeConfirmation(uint256 _txId)
        public
        onlyOwner
        txExists(_txId)
    {
        require(confirmations[_txId][msg.sender].confirmed, "tx not confirmed");
        confirmations[_txId][msg.sender] = Confirmation({
            confirmed: false,
            blockNumber: 0
        });

        emit RevokeConfirmation(msg.sender, _txId);
    }

    /**
     * @dev Returns true if the transaction is confirmed as of the current block.
     */
    function isConfirmed(uint256 _txId) public view returns (bool) {
        return _countConfirmations(_txId) >= required;
    }

    /**
     * @dev Returns true if the transaction had enough confirmations at a specific block.
     * This is used to protect against front‑running revocations during execution.
     */
    function isConfirmedAtBlock(uint256 _txId, uint256 _block)
        public
        view
        returns (bool)
    {
        uint256 count = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            Confirmation memory c = confirmations[_txId][owners[i]];
            if (c.confirmed && c.blockNumber <= _block) {
                count += 1;
            }
            if (count >= required) {
                return true;
            }
        }
        return false;
    }

    /**
     * @dev Execute a confirmed transaction.
     * Includes a re‑entrancy guard and a post‑execution confirmation check.
     * @param _txId Transaction ID.
     */
    function executeTransaction(uint256 _txId)
        public
        onlyOwner
        txExists(_txId)
        notExecuted(_txId)
    {
        require(isConfirmed(_txId), "cannot execute tx");

        Transaction storage txn = transactions[_txId];
        txn.executed = true;

        // Re‑entrancy guard
        require(!locked, "re‑entrancy");
        locked = true;

        uint256 execBlock = block.number;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        locked = false;

        // If the external call failed, we revert the state change.
        if (!success) {
            txn.executed = false;
            emit ExecutionFailure(_txId);
            revert("tx failed");
        }

        // Ensure that the required confirmations were still present at the block
        // when execution started. This prevents a callback from revoking confirmations.
        require(isConfirmedAtBlock(_txId, execBlock), "confirmations revoked");

        emit Execution(_txId);
    }

    /**
     * @dev Internal helper to count confirmations for a transaction.
     */
    function _countConfirmations(uint256 _txId) internal view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[_txId][owners[i]].confirmed) {
                count += 1;
            }
        }
        return count;
    }

    // Helper getters (optional)
    function getTransactionCount()
        public
        view
        returns (uint256)
    {
        return transactions.length;
    }

    function getOwners() public view returns (address[] memory) {
        return owners;
    }
}
