
🧠 Genius Council — Puzzle: "[ Crypto ] Fix zero-fee flash loans and add pool drainage protection

The flash loan contract `solidity/contracts/FlashLoan.sol` provides uncollateralized loans within a single transaction but the fee calculation at line 34 uses `loanAmount * feeBPS / 10000` which truncates to zero for loan amounts under 10000/feeBPS tokens, allowing free flash loans for small amounts.

### Fix

- Add a minimum fee of 1 token unit: `fee = max(loanAmount * feeBPS / 10000, 1)`
- Add a `maxLoanAmount` cap that limits flash loans to 50% of the pool balance to prevent pool drainage
- The callback validation at line 42 only checks `balanceOf(address(this)) >= balanceBefore + fee` but does not account for rebasing tokens that may change balance during the callback — add a `nonRebasin"
   Génies sélectionnés: shannon, turing, lovelace, abel, newton, gauss, pascal, simons

  [shannon] Claude Shannon... → WAIT
  [turing] Alan Turing... → WAIT
  [lovelace] Ada Lovelace... → WAIT
  [abel] Niels Henrik Abel... → WAIT
  [newton] Isaac Newton... → WAIT
  [gauss] Carl Friedrich Gauss... → WAIT
  [pascal] Blaise Pascal... → WAIT
  [simons] Jim Simons... → WAIT

  🔧 Génération de l'outil...

════════════════════════════════════════════════════════════
📊 PUZZLE: [ Crypto ] Fix zero-fee flash loans and add pool drainage protection

The flash loan contract `solidity/contracts/FlashLoan.sol` provides uncollateralized loans within a single transaction but the fee calculation at line 34 uses `loanAmount * feeBPS / 10000` which truncates to zero for loan amounts under 10000/feeBPS tokens, allowing free flash loans for small amounts.

### Fix

- Add a minimum fee of 1 token unit: `fee = max(loanAmount * feeBPS / 10000, 1)`
- Add a `maxLoanAmount` cap that limits flash loans to 50% of the pool balance to prevent pool drainage
- The callback validation at line 42 only checks `balanceOf(address(this)) >= balanceBefore + fee` but does not account for rebasing tokens that may change balance during the callback — add a `nonRebasin
────────────────────────────────────────────────────────────
🎯 CONSENSUS : WAIT  (100% confiance)
⚡ GODLIKE   : 0.000  💤 dormant

💡 INSIGHTS CLÉS :
  • **Claude Shannon** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
  • **Alan Turing** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
  • **Ada Lovelace** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
  • **Niels Henrik Abel** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
  • **Isaac Newton** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
════════════════════════════════════════════════════════════

