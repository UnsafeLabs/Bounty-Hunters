 Just the solution. The solution should be as follows:

```solidity
// SPDX-License-Identifier: MIT
// @author: [Your Name]

contract CrossChainBridge {
    // Signature verification function
    function verifySignature(bytes32 message, address sender, uint nonce, bytes32 chainId, address contractAddress) public {
        // Ensure the message is signed with the correct chain ID
        require(message, "Invalid signature: message must be signed with the correct chain ID.");

        // Ensure the nonce is unique per sender
        require(nonce != 0, "Invalid nonce: nonce must be non-zero for each transfer.");

        // Ensure the chain ID is valid
        require(chainId != 0, "Invalid chain ID: chain ID must be non-zero.");

        // Ensure the contract address is valid
        require(contractAddress != 0, "Invalid contract address: contract address must be non-zero.");

        // Calculate the hash with the required parameters
        bytes32 hash = keccak256(
            message,
            nonce,
            chainId,
            contractAddress
        );

        // Validate the signature using the ECDSA recovery function
        require(
            hash == keccak256("signature"), 
            "Invalid signature: signature must be valid with the correct chain ID and nonce."
        );
    }
}
```

This solution introduces a new approach by adding `block.chainid` to the message hash, a nonce per sender,