import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../contracts/FlashLoan.sol', import.meta.url), 'utf8');

function includes(fragment, message) {
  assert.ok(source.includes(fragment), message);
}

function matches(pattern, message) {
  assert.ok(pattern.test(source), message);
}

includes('uint256 public constant BPS_DENOMINATOR = 10_000;', 'basis point denominator should be explicit');
includes('uint256 public accountedPoolBalance;', 'pool balance should be tracked with internal accounting');
includes('function calculateFee(uint256 amount) public view returns (uint256)', 'fee helper should be public for verification');
matches(/if\s*\(\s*fee\s*==\s*0\s*\)\s*\{\s*return\s+1;/s, 'small loans must pay at least one token unit');
includes('function maxLoanAmount() public view returns (uint256)', 'max loan helper should be exposed');
matches(/return\s+accountedPoolBalance\s*\/\s*2\s*;/, 'max loan amount should be 50% of the accounted pool');
matches(/require\s*\(\s*amount\s*<=\s*maxLoanAmount\(\)\s*,\s*"Exceeds max loan"\s*\)/, 'flash loans over the cap should be rejected');
matches(/require\s*\(\s*balanceBefore\s*==\s*poolBalance\s*,\s*"Unsupported rebasing token"\s*\)/, 'loan start should reject balance drift from rebasing/unaccounted tokens');
matches(/require\s*\(\s*balanceAfter\s*==\s*expectedBalance\s*,\s*"Loan not repaid"\s*\)/, 'loan completion should require exact accounted repayment plus fee');
matches(/accountedPoolBalance\s*=\s*expectedBalance\s*;\s*totalFees\s*\+=\s*fee\s*;/s, 'fees should accrue into both pool accounting and totalFees');
includes('function pause() external onlyOwner', 'owner should be able to pause flash loans');
includes('function unpause() external onlyOwner', 'owner should be able to unpause flash loans');
matches(/function\s+flashLoan\(uint256 amount, bytes calldata data, address receiver\)\s+public\s+whenNotPaused/, 'flash loan entrypoint should be pause-gated');
matches(/require\s*\(\s*loanToken\.transfer\(receiver,\s*amount\)\s*,\s*"Transfer failed"\s*\)/, 'loan transfer result should be checked');
matches(/require\s*\(\s*loanToken\.transferFrom\(msg\.sender,\s*address\(this\),\s*amount\)\s*,\s*"Transfer failed"\s*\)/, 'deposit transfer result should be checked');
matches(/require\s*\(\s*balanceAfter\s*==\s*balanceBefore\s*\+\s*amount\s*,\s*"Unsupported rebasing token"\s*\)/, 'deposits should reject fee-on-transfer/rebasing balance drift');
matches(/accountedPoolBalance\s*-=\s*fees\s*;/, 'fee withdrawal should reduce accounted pool balance');

const metadata = JSON.parse(readFileSync(new URL('../contracts/.contributor.json', import.meta.url), 'utf8'));
assert.equal(metadata.agent, 'Codex GPT-5');
assert.ok(!metadata.initialized_with.includes('You are'), 'metadata must not leak private prompts');

console.log('flashloan pool-protection checks passed');
