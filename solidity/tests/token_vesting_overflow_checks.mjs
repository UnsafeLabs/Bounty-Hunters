import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "contracts", "TokenVesting.sol");
const source = fs.readFileSync(sourcePath, "utf8");

function assertIncludes(text, message) {
  assert.ok(source.includes(text), message);
}

function assertMatches(pattern, message) {
  assert.match(source, pattern, message);
}

function assertNotIncludes(text, message) {
  assert.ok(!source.includes(text), message);
}

assertIncludes('require(_vestingDuration > 0, "Invalid duration");', "duration must be non-zero");
assertIncludes("uint256 base = totalAllocation / duration;", "vesting must divide allocation before multiplying elapsed");
assertIncludes("uint256 remainder = totalAllocation % duration;", "vesting must preserve remainder");
assertIncludes("return base * elapsed + remainder * elapsed / duration;", "vesting must add proportional remainder back");
assertNotIncludes("return totalAllocation * elapsed / duration;", "unsafe multiplication-first vesting formula must be removed");
assertMatches(
  /if \(block\.timestamp >= start \+ duration\) return totalAllocation;/,
  "full vesting completion must return the exact total allocation",
);
assertMatches(
  /uint256 payableVested = vested > claimed \? vested - claimed : 0;[\s\S]*uint256 unvested = totalAllocation - claimed - payableVested;/,
  "revocation must return only truly unvested tokens after accounting for claimed and payable vested tokens",
);
assertMatches(
  /if \(payableVested > 0\)[\s\S]*claimed \+= payableVested;[\s\S]*token\.transfer\(beneficiary, payableVested\)/,
  "revocation must pay outstanding vested tokens to the beneficiary",
);
assertIncludes('require(!revoked, "Vesting revoked");', "claims must stop after revocation");
assertIncludes('require(token.transfer(beneficiary, amount), "Token transfer failed");', "claim transfer result must be checked");

console.log("TokenVesting overflow checks passed.");
