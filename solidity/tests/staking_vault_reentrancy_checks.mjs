import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "contracts", "StakingVault.sol");
const source = fs.readFileSync(sourcePath, "utf8");
const withdrawBody = source.slice(source.indexOf("function withdraw"), source.indexOf("function claimRewards"));
const claimBody = source.slice(source.indexOf("function claimRewards"), source.indexOf("function getStakedBalance"));

function assertIncludes(text, message) {
  assert.ok(source.includes(text), message);
}

function assertMatches(pattern, message, text = source) {
  assert.match(text, pattern, message);
}

function assertBefore(first, second, message, text = source) {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  assert.notEqual(firstIndex, -1, `${first} not found`);
  assert.notEqual(secondIndex, -1, `${second} not found`);
  assert.ok(firstIndex < secondIndex, message);
}

assertIncludes('import "@openzeppelin/contracts/security/ReentrancyGuard.sol";', "ReentrancyGuard must be imported");
assertIncludes("contract StakingVault is ReentrancyGuard", "vault must inherit ReentrancyGuard");
assertMatches(/function withdraw\(uint256 amount\) external nonReentrant/, "withdraw must be nonReentrant");
assertMatches(/function claimRewards\(\) external nonReentrant/, "claimRewards must be nonReentrant");
assertBefore("balances[msg.sender] -= amount;", "payable(msg.sender).call{value: amount}", "withdraw balance update must precede ETH transfer", withdrawBody);
assertBefore("totalStaked -= amount;", "payable(msg.sender).call{value: amount}", "withdraw totalStaked update must precede ETH transfer", withdrawBody);
assertBefore("rewards[msg.sender] = 0;", "payable(msg.sender).call{value: reward}", "claimRewards reward reset must precede ETH transfer", claimBody);
assertIncludes('require(stakingToken.transferFrom(msg.sender, address(this), amount), "Stake transfer failed");', "stake must check ERC20 transfer result");
assertIncludes('require(_stakingToken != address(0), "Invalid staking token");', "constructor must reject zero token");

console.log("StakingVault reentrancy checks passed.");
