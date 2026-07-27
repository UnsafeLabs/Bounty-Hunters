const solc = require("solc");
const fs = require("fs");
const path = require("path");

function findImports(importPath) {
  const possible = [
    path.join(__dirname, "..", "node_modules", importPath),
    path.join(__dirname, "..", "contracts", importPath),
  ];
  for (const p of possible) {
    if (fs.existsSync(p)) {
      return { contents: fs.readFileSync(p, "utf8") };
    }
  }
  const ozAlt = path.join(__dirname, "..", "node_modules", "@openzeppelin", "contracts", importPath.replace("@openzeppelin/contracts/", ""));
  if (fs.existsSync(ozAlt)) {
    return { contents: fs.readFileSync(ozAlt, "utf8") };
  }
  const ozDirect = path.join(__dirname, "..", "node_modules", importPath);
  if (fs.existsSync(ozDirect)) {
    return { contents: fs.readFileSync(ozDirect, "utf8") };
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

const contract = output.contracts["contracts/LiquidityPool.sol"]["LiquidityPool"];
const abi = contract.abi;

const functions = abi.filter(x => x.type === "function").map(x => x.name);
const events = abi.filter(x => x.type === "event").map(x => x.name);

const checks = {
  "addLiquidity exists": functions.includes("addLiquidity"),
  "removeLiquidity exists": functions.includes("removeLiquidity"),
  "sync function exists": functions.includes("sync"),
  "Sync event exists": events.includes("Sync"),
  "bytecode generated": contract.evm.bytecode.object.length > 0,
  "MINIMUM_LIQUIDITY constant (1000)": poolSource.includes("MINIMUM_LIQUIDITY = 1000"),
  "no _mint to address(0)": !poolSource.includes("_mint(address(0)"),
  "removeLiquidity uses reserveA/reserveB": /amount[AB]\s*=\s*lpTokens\s*\*\s*reserve[AB]\s*\/\s*totalSupply/.test(poolSource),
  "no token.balanceOf in removeLiquidity": !(/function\s+removeLiquidity[\s\S]*?function\s+/.exec(poolSource)?.[0]?.includes("tokenA.balanceOf")),
  "sync updates reserves": poolSource.includes("reserveA = tokenA.balanceOf(address(this))"),
  "compilation clean": !hasError,
};

let passed = 0, failed = 0;
Object.entries(checks).forEach(([name, ok]) => {
  const status = ok ? "✓" : "✗";
  console.log(`  ${status} ${name}`);
  if (ok) passed++; else failed++;
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
