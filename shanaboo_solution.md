Looking at the issue description, I need to fix the flash loan contract to address several security and functionality issues. Let me analyze what needs to be done:

1. Fix zero-fee flash loans by adding minimum fee protection
2. Add max loan amount cap (50% of pool balance)
3. Add protection against rebasing token exploits
4. Add emergency pause functionality
5. Create proper internal accounting

Let me first look at the existing FlashLoan.sol file structure and then provide the fixes:

```diff
--- a/solidity/contracts/FlashLoan.sol
+++ b/solidity/contracts/FlashLoan.sol
@@ -1,3 + 1,109 @@
+// SPDX-License-Identifier: MIT
+pragma solidity ^0.8.0;
+
+import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
+import "@openzeppelin/contracts/access/Ownable.sol";
+import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
+
+contract FlashLoan is Ownable, ReentrancyGuard {
+    IERC20 public token;
+    uint256 public feeBPS;
+    uint256 public maxLoanAmount; // 50% of pool balance
+    bool public paused = false;
+    
+    event FlashLoanExecuted(
+        address indexed receiver,
+        uint256 amount,
+        uint256 fee
+    );
+    
+    event FlashLoanPaused(bool paused);
+    
+    constructor(address _token, uint256 _feeBPS) {
+        token = IERC20(_token);
+        feeBPS = _feeBPS;
+        maxLoanAmount = token.balanceOf(address(this)) / 2; // 50% of pool balance
+    }
+    
+    function setFeeBPS(uint256 _newFeeBPS) public onlyOwner {
+        feeBPS = _newFeeBPS;
+    }
+    
+    function setPaused(bool _paused) public onlyOwner {
+        paused = _paused;
+        emit FlashLoanPaused(_paused);
+    }
+    
+    function executeFlashLoan(uint256 amount) external nonReentrant whenNotPaused {
+        require(amount <= maxLoanAmount, "Loan amount exceeds max allowed");
+        require(address(token) != address(0), "Token not set");
+        
+        uint256 fee = calculateFee(amount);
+        // Ensure minimum fee of 1
+        if (fee == 0) {
+            fee = 1;
+        }
+        
+        uint256 balanceBefore = token.balanceOf(address(this));
+        uint256 balanceAfter = balanceBefore + fee;
+        
+        // Check if loan amount doesn't exceed 50% of pool
+        require(amount <= maxLoanAmount, "Loan too large");
+        require(token.transfer(msg.sender, amount), "Transfer failed");
+        
+        // Update max loan amount based on current pool balance
+        maxLoanAmount = token.balanceOf(address(this)) / 2;
+        
+        emit FlashLoanExecuted(msg.sender, amount, fee);
+    }
+    
+    function calculateFee(uint256 amount) internal view returns (uint256) {
+        uint256 calculatedFee = amount * feeBPS / 10000;
+        // Ensure minimum fee of 1
+        if (calculatedFee == 0) {
+            calculatedFee = 1;
+        }
+        return calculatedFee;
+    }
+    
+    function updateMaxLoanAmount() public {
+        maxLoanAmount = token.balanceOf(address(this)) / 2;
+    }
+    
+    modifier whenNotPaused() {
+        require(!paused, "Flash loans are paused");
+        _;
+    }
+    
+    function emergencyPause() external onlyOwner {
+        paused = true;
+    }
+    
+    function emergencyUnpause() external onlyOwner {
+        paused = false;
+    }
+    
+    function isPaused() public view returns (bool) {
+        return paused;
+    }
+}
+
+// Additional helper functions for the contract
+function max(uint256 a, uint256 b) pure returns (uint256) {
+    return a > b ? a : b;
+}
+
+function min(uint256 a, uint256 b) pure returns (uint256) {
+    return a < b ? a : b;
+}
+
+function calculateMinFee(uint256 loanAmount, uint256 feeBPS) pure returns (uint256) {
+    uint256 calculatedFee = loanAmount * feeBPS / 10000;
+    return max(calculatedFee, 1);
+}
+
+// Reentrancy protection
+contract ReentrancyGuard {
+    uint256 private _guardCounter;
+    
+    constructor() {
+        _guardCounter = 1;
+    }
+    
+    modifier nonReentrant() {
+        require(_guardCounter == 0, "ReentrancyGuard: reentrant call");
+        _guardCounter = 1;
+        _;
+        _guardCounter = 0;
+    }
+}
\ No newline at end of file
--- a/solidity/contracts/FlashLoan.sol
+++ b/solidity/contracts/FlashLoan.sol
@@ -1,109 + 1,109 @@
-// SPDX-License-Identifier: MIT
-pragma solidity ^0.8.0;
-
-import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
-import "@openzeppelin/contracts/access/Ownable.sol";
-import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
-
-contract FlashLoan is Ownable, ReentrancyGuard {
-    IERC20 public token;
-    uint256 public feeBPS;
-    uint256 public maxLoanAmount; // 50% of pool balance
-    bool public paused = false;
-    
-    event FlashLoanExecuted(
-        address indexed receiver,
-        uint256 amount,
-        uint256 fee
-    );
-    
-    event FlashLoanPaused(bool paused);
-    
-    constructor(address _token, uint256 _feeBPS) {
-        token = IERC20(_token);
-        feeBPS = _feeBPS;
-        maxLoanAmount = token.balanceOf(address(this)) / 2; // 50% of pool balance
-    }
-    
-    function setFeeBPS(uint256 _newFeeBPS) public onlyOwner {
-        feeBPS = _newFeeBPS;
-    }
-    
-    function setPaused(bool _paused) public onlyOwner {
-        paused