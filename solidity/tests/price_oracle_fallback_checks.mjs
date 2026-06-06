import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../contracts/PriceOracle.sol', import.meta.url), 'utf8');

function includes(fragment, message) {
  assert.ok(source.includes(fragment), message);
}

function matches(pattern, message) {
  assert.ok(pattern.test(source), message);
}

includes('AggregatorV3Interface public primaryFeed;', 'primary Chainlink feed should remain explicit');
includes('AggregatorV3Interface public fallbackFeed;', 'fallback oracle should be configured on-chain');
includes('uint256 public MAX_STALENESS = 3600;', 'default staleness should be one hour');
includes('event StalePrice(address indexed feed, uint256 updatedAt);', 'fallback path should emit stale primary timestamp');
includes('function getLatestPrice() external returns (int256)', 'price lookup should be able to emit fallback events');
matches(/_validateRound\(primary\);[\s\S]*if\s*\(\s*_isFresh\(primary\.updatedAt\)\s*\)/, 'primary response should validate before freshness routing');
matches(/require\s*\(\s*address\(fallbackFeed\)\s*!=\s*address\(0\)\s*,\s*"Stale price"\s*\)/, 'stale primary should require a fallback feed');
matches(/emit\s+StalePrice\(address\(primaryFeed\),\s*primary\.updatedAt\);/, 'stale primary timestamp should be emitted when falling back');
matches(/FeedResult memory fallbackResult\s*=\s*_readFeed\(fallbackFeed\);[\s\S]*_validateRound\(fallbackResult\);[\s\S]*require\s*\(\s*_isFresh\(fallbackResult\.updatedAt\)\s*,\s*"Stale price"\s*\)/, 'fallback should also reject invalid or stale data');
matches(/require\s*\(\s*result\.price\s*>\s*0\s*,\s*"Invalid price"\s*\)/, 'zero and negative prices should revert clearly');
matches(/require\s*\(\s*result\.answeredInRound\s*>=\s*result\.roundId\s*,\s*"Incomplete round"\s*\)/, 'incomplete rounds should be rejected');
matches(/return\s+updatedAt\s*!=\s*0\s*&&\s*updatedAt\s*<=\s*block\.timestamp\s*&&\s*block\.timestamp\s*-\s*updatedAt\s*<\s*MAX_STALENESS\s*;/, 'freshness should reject missing, future, and stale timestamps');
includes('function setFallbackFeed(address _fallbackFeed) external onlyOwner', 'owner should configure fallback feed');
includes('function setMaxStaleness(uint256 _maxStaleness) external onlyOwner', 'owner should configure max staleness');
matches(/require\s*\(\s*_maxStaleness\s*>\s*0\s*,\s*"Invalid staleness"\s*\)/, 'max staleness should not be set to zero');

const metadata = JSON.parse(readFileSync(new URL('../contracts/.generation_meta.json', import.meta.url), 'utf8'));
assert.equal(metadata.agent, 'Codex GPT-5');
assert.ok(!metadata.initial_directives.includes('You are'), 'metadata must not leak private directives');

console.log('price oracle fallback checks passed');
