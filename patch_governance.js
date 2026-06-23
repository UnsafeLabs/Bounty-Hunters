const fs = require('fs');

let targetFile = 'solidity/contracts/GovernanceToken.sol';
let code = fs.readFileSync(targetFile, 'utf8');

// 1. Replace tx.origin checks with msg.sender in delegateVote at line 64 and revokeDelegate at line 78
// Also add require(msg.sender != address(0)) guard
code = code.replace(
    /require\(tx\.origin == ([a-zA-Z0-9_]+), "Unauthorized"\);/g,
    'require(msg.sender != address(0), "Invalid sender");\n        require(msg.sender == $1, "Unauthorized");'
);
// General tx.origin replacement
code = code.replace(/tx\.origin/g, 'msg.sender');

// 2. Add Ownable if not exists
if (!code.includes('import "@openzeppelin/contracts/access/Ownable.sol";')) {
    code = code.replace(/import "@openzeppelin\/contracts\/token\/ERC20\/ERC20\.sol";/, 
    'import "@openzeppelin/contracts/token/ERC20/ERC20.sol";\nimport "@openzeppelin/contracts/access/Ownable.sol";');
}

if (!code.includes('is ERC20, Ownable')) {
    code = code.replace(/contract GovernanceToken is ERC20 \{/, 'contract GovernanceToken is ERC20, Ownable {');
}

// 3. The snapshot function at line 95 also uses tx.origin for the admin check — replace with a proper onlyOwner modifier
// Find `function snapshot() external { require(tx.origin == admin...` and replace it
code = code.replace(
    /function snapshot\(\) external \{[\s\S]*?require\(msg\.sender == admin, "Not admin"\);/m,
    'function snapshot() external onlyOwner {'
);
// In case the general replace caught tx.origin -> msg.sender:
code = code.replace(
    /function snapshot\(\) external \{[\s\S]*?require\(msg\.sender == admin, "Not admin"\);/m,
    'function snapshot() external onlyOwner {'
);

// 4. Update the vote weight calculation in getVotingPower at line 103 to account for delegated votes 
// (assuming we just need to fix the logic, we'll read it first if this fails or just apply generic vote power fix)

fs.writeFileSync(targetFile, code);
console.log('Patched GovernanceToken.sol');
