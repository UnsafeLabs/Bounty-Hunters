const solc = require("solc");
const fs = require("fs");
const path = require("path");

function findImports(importPath) {
  const possible = [
    path.join(__dirname, "..", "node_modules", importPath),
    path.join(__dirname, "..", "contracts", importPath),
    path.join(__dirname, "..", "contracts", "test", importPath),
  ];
  for (const p of possible) {
    if (fs.existsSync(p)) {
      return { contents: fs.readFileSync(p, "utf8") };
    }
  }
  const nodeModulesAlt = path.join(__dirname, "..", "node_modules", "@openzeppelin", "contracts", importPath.replace("@openzeppelin/contracts/", ""));
  if (fs.existsSync(nodeModulesAlt)) {
    return { contents: fs.readFileSync(nodeModulesAlt, "utf8") };
  }
  return { error: `File not found: ${importPath}` };
}

const poolSource = fs.readFileSync(path.join(__dirname, "..", "contracts", "LiquidityPool.sol"), "utf8");

const input = {
  language: "Solidity",
  sources: {
    "contracts/LiquidityPool.sol": { content: poolSource },
  },
  settings: {
    outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } },
    evmVersion: "paris",
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

const errors = output.errors || [];
const hasError = errors.some(e => e.severity === "error");

if (hasError) {
  console.error("COMPILATION FAILED:");
  errors.forEach(e => console.error(e.formattedMessage || e.message));
  process.exit(1);
}

console.log("COMPILATION SUCCESSFUL");
console.log(`Contract: LiquidityPool`);

const contract = output.contracts["contracts/LiquidityPool.sol"]["LiquidityPool"];
const abi = contract.abi;

const functions = abi.filter(x => x.type === "function").map(x => x.name);
const events = abi.filter(x => x.type === "event").map(x => x.name);

console.log(`Functions: ${functions.join(", ")}`);
console.log(`Events: ${events.join(", ")}`);

const hasAddLiquidity = functions.includes("addLiquidity");
const hasRemoveLiquidity = functions.includes("removeLiquidity");
const hasSync = functions.includes("sync");
const hasSyncEvent = events.includes("Sync");
const hasMinLiquidity = contract.evm.bytecode.object.length > 0;

const checks = [
  ["addLiquidity exists", hasAddLiquidity],
  ["removeLiquidity exists", hasRemoveLiquidity],
  ["sync function exists", hasSync],
  ["Sync event exists", hasSyncEvent],
  ["bytecode generated", hasMinLiquidity],
  ["MINIMUM_LIQUIDITY constant (1000)", poolSource.includes("MINIMUM_LIQUIDITY = 1000")],
  ["_mint called with address(0)", poolSource.includes("_mint(address(0)") || poolSource.includes('_mint(address(0)')],
  ["reserve-based removeLiquidity", poolSource.includes("reserveA") && poolSource.includes("reserveB")],
  ["removeLiquidity uses reserveA/reserveB", poolSource.includes("amountA = lpTokens * reserveA / totalSupply()") && poolSource.includes("amountB = lpTokens * reserveB / totalSupply()")],
];

let passed = 0;
let failed = 0;
checks.forEach(([name, ok]) => {
  if (ok) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}`); failed++; }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
