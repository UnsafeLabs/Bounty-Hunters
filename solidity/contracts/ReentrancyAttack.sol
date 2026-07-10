// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ReentrancyAttack {
    address public wallet;

    constructor(address _wallet) {
        wallet = _wallet;
    }

    function tryReenter(uint256 _txId) external {
        (bool success, ) = wallet.call(abi.encodeWithSignature("executeTransaction(uint256)", _txId));
        require(!success, "Reentrancy guard missing");
    }
}


