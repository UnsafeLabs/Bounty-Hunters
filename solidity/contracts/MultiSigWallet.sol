// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MultiSigWallet {
    address[] public owners;
    uint256 public required;
    uint256 public transactionCount;

    struct Confirmation {
        bool confirmed;
        uint256 confirmedAtBlock;
        uint256 revokedAtBlock; // 0 if not revoked since last confirm
    }

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => Confirmation)) public confirmations;
    mapping(address => bool) public isOwner;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    event Submitted(uint256 indexed txId);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event Revoked(uint256 indexed txId, address indexed owner);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "Reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor(address[] memory _owners, uint256 _required) {
        require(_owners.length > 0, "No owners");
        require(_required > 0 && _required <= _owners.length, "Invalid required");
        for (uint256 i = 0; i < _owners.length; i++) {
            require(_owners[i] != address(0), "Zero address owner");
            require(!isOwner[_owners[i]], "Duplicate owner");
            isOwner[_owners[i]] = true;
        }
        owners = _owners;
        required = _required;
        _status = _NOT_ENTERED;
    }

    function submitTransaction(address to, uint256 value, bytes calldata data)
        external
        onlyOwner
        returns (uint256)
    {
        require(to != address(0), "Zero address");
        // Contract call targets must have code; pure ETH transfers to EOAs are allowed.
        if (data.length > 0) {
            require(to.code.length > 0, "Target has no code");
        }

        uint256 txId = transactionCount++;
        transactions[txId] = Transaction({
            to: to,
            value: value,
            data: data,
            executed: false
        });
        emit Submitted(txId);
        return txId;
    }

    function confirmTransaction(uint256 txId) external onlyOwner {
        require(_status != _ENTERED, "Cannot confirm during execution");
        require(!transactions[txId].executed, "Already executed");
        require(!confirmations[txId][msg.sender].confirmed, "Already confirmed");
        confirmations[txId][msg.sender] = Confirmation({
            confirmed: true,
            confirmedAtBlock: block.number,
            revokedAtBlock: 0
        });
        emit Confirmed(txId, msg.sender);
    }

    function revokeConfirmation(uint256 txId) external onlyOwner {
        require(_status != _ENTERED, "Cannot revoke during execution");
        require(!transactions[txId].executed, "Already executed");
        require(confirmations[txId][msg.sender].confirmed, "Not confirmed");
        Confirmation storage conf = confirmations[txId][msg.sender];
        conf.confirmed = false;
        conf.revokedAtBlock = block.number;
        emit Revoked(txId, msg.sender);
    }

    function getConfirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmations[txId][owners[i]].confirmed) count++;
        }
    }

    /// @notice Whether `owner` counted as confirmed for `txId` as of `blockNumber`.
    /// @dev Uses confirmation/revocation block history so same-block front-run revokes
    ///      do not erase prior-block confirmation state used by execute snapshots.
    function isConfirmedAtBlock(uint256 txId, address owner, uint256 blockNumber)
        public
        view
        returns (bool)
    {
        Confirmation storage conf = confirmations[txId][owner];
        if (conf.confirmedAtBlock == 0 || conf.confirmedAtBlock > blockNumber) {
            return false;
        }
        if (conf.revokedAtBlock != 0 && conf.revokedAtBlock <= blockNumber) {
            return false;
        }
        return true;
    }

    function getConfirmationCountAtBlock(uint256 txId, uint256 blockNumber)
        public
        view
        returns (uint256 count)
    {
        for (uint256 i = 0; i < owners.length; i++) {
            if (isConfirmedAtBlock(txId, owners[i], blockNumber)) count++;
        }
    }

    function executeTransaction(uint256 txId) external onlyOwner nonReentrant {
        require(!transactions[txId].executed, "Already executed");
        require(block.number > 0, "Invalid block");

        // Snapshot prior block so a same-block front-run revoke cannot grief execution.
        uint256 snapshotBlock = block.number - 1;
        require(
            getConfirmationCountAtBlock(txId, snapshotBlock) >= required,
            "Not enough confirmations"
        );

        Transaction storage txn = transactions[txId];
        txn.executed = true;

        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "Execution failed");

        emit Executed(txId);
    }

    receive() external payable {}
}
