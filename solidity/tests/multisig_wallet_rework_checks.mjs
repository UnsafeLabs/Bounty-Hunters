import { readFileSync } from "node:fs";

const source = readFileSync("solidity/contracts/MultiSigWallet.sol", "utf8");
const provenance = JSON.parse(readFileSync("solidity/contracts/_provenance.json", "utf8"));

const checks = [
  ["zero-address target rejected", /require\(to != address\(0\), "Invalid target"\)/.test(source)],
  ["contract target required for calldata", /require\(data\.length == 0 \|\| to\.code\.length > 0, "Target is not contract"\)/.test(source)],
  ["bool confirmations getter preserved", /mapping\(uint256 => mapping\(address => bool\)\) public confirmations;/.test(source)],
  ["confirmation block metadata", /confirmationBlocks\[txId\]\[msg\.sender\] = block\.number;/.test(source)],
  ["confirmation timestamp metadata", /confirmationTimestamps\[txId\]\[msg\.sender\] = block\.timestamp;/.test(source)],
  ["revocation block metadata", /revocationBlocks\[txId\]\[msg\.sender\] = block\.number;/.test(source)],
  ["revocation timestamp metadata", /revocationTimestamps\[txId\]\[msg\.sender\] = block\.timestamp;/.test(source)],
  ["isConfirmedAtBlock helper", /function isConfirmedAtBlock\(uint256 txId, address owner, uint256 blockNumber\) public view returns \(bool\)/.test(source)],
  ["block-level count helper", /function getConfirmationCountAtBlock\(uint256 txId, uint256 blockNumber\) public view returns \(uint256 count\)/.test(source)],
  ["execute uses block snapshot", /uint256 confirmationSnapshotBlock = block\.number;[\s\S]*getConfirmationCountAtBlock\(txId, confirmationSnapshotBlock\) >= required/.test(source)],
  ["execution lock guard", /modifier nonReentrantExecution\(\)[\s\S]*executionLocked = true;[\s\S]*executionLocked = false;/.test(source)],
  ["confirm blocked during execution", /function confirmTransaction[\s\S]*require\(!executionLocked, "Execution in progress"\);/.test(source)],
  ["revoke blocked during execution", /function revokeConfirmation[\s\S]*require\(!executionLocked, "Execution in progress"\);/.test(source)],
  ["executed set before external call", /txn\.executed = true;[\s\S]*txn\.to\.call/.test(source)],
  ["safe provenance", provenance.tool_name === "Codex GPT-5" && !/paste everything|system message|developer message/i.test(provenance.boot_context)],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(failed.map(([name]) => `FAILED: ${name}`).join("\n"));
  process.exit(1);
}

console.log(`MultiSigWallet #916 rework checks passed (${checks.length})`);
