+ // SPDX-License-Identifier: MIT
+ pragma solidity ^0.8.20;
+ 
+ import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
+ import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
+ 
+ contract CrossChainBridge is EIP712 {
+     using ECDSA for bytes32;
+ 
+     address public validator;
+     mapping(address => uint256) public nonces;
+ 
+     bytes32 private constant TRANSFER_TYPEHASH = keccak256(
+         "Transfer(address sender,address recipient,uint256 amount,uint256 nonce)"
+     );
+ 
+     event TransferProcessed(address indexed sender, address indexed recipient, uint256 amount, uint256 nonce);
+ 
+     constructor(address _validator) EIP712("CrossChainBridge", "1") {
+         validator = _validator;
+     }
+ 
+     function processTransfer(
+         address recipient,
+         uint256 amount,
+         uint256 nonce,
+         bytes calldata signature
+     ) external {
+         require(nonce == nonces[msg.sender], "Invalid nonce");
+ 
+         bytes32 structHash = keccak256(
+             abi.encode(
+                 TRANSFER_TYPEHASH,
+                 msg.sender,
+                 recipient,
+                 amount,
+                 nonce
+             )
+         );
+ 
+         bytes32 digest = _hashTypedDataV4(structHash);
+         address signer = digest.recover(signature);
+         require(signer == validator && signer != address(0), "Invalid signature");
+ 
+         nonces[msg.sender]++;
+ 
+         // Transfer logic (e.g., mint on destination)
+         emit TransferProcessed(msg.sender, recipient, amount, nonce);
+     }
+ 
+     function getNonce(address sender) external view returns (uint256) {
+         return nonces[sender];
+     }
+ 
+     // EIP-712 domain separator is automatically built by the EIP712 base contract
+     // using name, version, block.chainid, and this contract's address.
+ }