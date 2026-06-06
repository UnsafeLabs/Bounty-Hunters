import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "contracts", "GovernanceToken.sol");
const source = fs.readFileSync(sourcePath, "utf8");

function assertIncludes(text, message) {
  assert.ok(source.includes(text), message);
}

function assertNotIncludes(text, message) {
  assert.ok(!source.includes(text), message);
}

function assertMatches(pattern, message) {
  assert.match(source, pattern, message);
}

assertNotIncludes("tx.origin", "contract must not use tx.origin for authorization or delegation");
assertIncludes('import "@openzeppelin/contracts/access/Ownable.sol";', "OpenZeppelin Ownable must be used");
assertIncludes("contract GovernanceToken is ERC20, Ownable", "contract must inherit Ownable");
assertIncludes("Ownable(msg.sender)", "deployer must become the Ownable owner");
assertMatches(/function snapshot\(\) external onlyOwner/, "snapshot must be protected by onlyOwner");
assertMatches(/function delegateVote\(address to\) external[\s\S]*require\(msg\.sender != address\(0\)/, "delegateVote must use msg.sender");
assertMatches(/delegates\[msg\.sender\] = to;/, "delegation must be recorded for msg.sender");
assertMatches(/emit DelegateChanged\(msg\.sender, to\);/, "delegate event must report msg.sender as delegator");
assertMatches(/function revokeDelegate\(\) external[\s\S]*delegates\[msg\.sender\]/, "revokeDelegate must use msg.sender");
assertMatches(
  /uint256 directPower = delegates\[account\] == address\(0\) \? balanceOf\(account\) : 0;/,
  "delegators must not retain direct voting power after delegation",
);
assertIncludes("return directPower + delegatedPower[account];", "delegated votes must still count for the delegate");

console.log("GovernanceToken tx.origin protection checks passed.");
