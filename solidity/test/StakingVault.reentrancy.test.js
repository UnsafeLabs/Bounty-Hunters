const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const path = require("node:path");

const source = readFileSync(
  path.join(__dirname, "../contracts/StakingVault.sol"),
  "utf8",
);

function functionBody(name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} function should exist`);

  const openingBrace = source.indexOf("{", start);
  let depth = 0;

  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openingBrace + 1, index);
      }
    }
  }

  throw new Error(`Could not parse ${name} body`);
}

test("withdraw and claimRewards use ReentrancyGuard", () => {
  assert.match(source, /import\s+"@openzeppelin\/contracts\/utils\/ReentrancyGuard\.sol";/);
  assert.match(source, /contract\s+StakingVault\s+is\s+ReentrancyGuard/);
  assert.match(source, /function\s+withdraw\s*\([^)]*\)\s+external\s+nonReentrant/);
  assert.match(source, /function\s+claimRewards\s*\([^)]*\)\s+external\s+nonReentrant/);
});

test("withdraw updates stake accounting before transferring ETH", () => {
  const body = functionBody("withdraw");

  assert.ok(
    body.indexOf("balances[msg.sender] -= amount;") < body.indexOf(".call{value: amount}"),
    "balance must be reduced before the external ETH transfer",
  );
  assert.ok(
    body.indexOf("totalStaked -= amount;") < body.indexOf(".call{value: amount}"),
    "total staked must be reduced before the external ETH transfer",
  );
});

test("claimRewards clears rewards before transferring ETH", () => {
  const body = functionBody("claimRewards");

  assert.ok(
    body.indexOf("rewards[msg.sender] = 0;") < body.indexOf(".call{value: reward}"),
    "reward balance must be cleared before the external ETH transfer",
  );
});
