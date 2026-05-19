// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract CrossChainBridge {
    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public executed;

    event Bridged(address indexed user, uint256 amount, uint256 targetChainId);

    function bridge(
        address user,
        uint256 amount,
        uint256 targetChainId,
        bytes memory signature
    ) external {
        // Fix for #920: Prevent cross-chain and same-chain replay attacks
        // Added block.chainid and address(this) to domain separator
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                user,
                amount,
                targetChainId,
                nonces[user],
                block.chainid,
                address(this)
            )
        );
        
        bytes32 ethSignedMessageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );

        address signer = recoverSigner(ethSignedMessageHash, signature);
        require(signer == user, "Invalid signature");
        require(signer != address(0), "ecrecover returned 0"); // Explicit check
        require(!executed[messageHash], "Already executed");

        nonces[user]++;
        executed[messageHash] = true;

        emit Bridged(user, amount, targetChainId);
    }

    function recoverSigner(bytes32 _ethSignedMessageHash, bytes memory _signature)
        internal
        pure
        returns (address)
    {
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(_signature);
        return ecrecover(_ethSignedMessageHash, v, r, s);
    }

    function splitSignature(bytes memory sig)
        internal
        pure
        returns (
            bytes32 r,
            bytes32 s,
            uint8 v
        )
    {
        require(sig.length == 65, "invalid signature length");
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
    }
}
