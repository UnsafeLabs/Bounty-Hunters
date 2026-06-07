import { readFileSync } from "node:fs";

const files = {
  engine: "t3code/apps/server/src/orchestration/Layers/OrchestrationEngine.ts",
  engineService: "t3code/apps/server/src/orchestration/Services/OrchestrationEngine.ts",
  receiptService: "t3code/apps/server/src/persistence/Services/OrchestrationCommandReceipts.ts",
  receiptLayer: "t3code/apps/server/src/persistence/Layers/OrchestrationCommandReceipts.ts",
  contracts: "t3code/packages/contracts/src/orchestration.ts",
  test: "t3code/apps/server/src/orchestration/Layers/OrchestrationEngine.test.ts",
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, readFileSync(path, "utf8")]),
);

const checks = [
  ["contract allows interrupted receipt status", source.contracts.includes('"interrupted"')],
  [
    "receipt repository exposes interrupted aggregate query",
    source.receiptService.includes("listInterruptedByAggregate") &&
      source.receiptLayer.includes("status = 'interrupted'"),
  ],
  [
    "engine exposes reconnect/resume query",
    source.engineService.includes("getInterruptedCommands") &&
      source.engine.includes("commandReceiptRepository.listInterruptedByAggregate"),
  ],
  [
    "dispatch await registers onInterrupt checkpoint",
    source.engine.includes("Effect.onInterrupt") &&
      source.engine.includes("checkpointInterruptedEnvelope") &&
      source.engine.includes("dispatch fiber interrupted before completion"),
  ],
  [
    "interrupt checkpoint stores sequence and metadata",
    source.engine.includes('status: "interrupted"') &&
      source.engine.includes("resultSequence: commandReadModel.snapshotSequence") &&
      source.engine.includes("fiberId") &&
      source.engine.includes("interruptedAt"),
  ],
  [
    "interrupted receipts remain resumable",
    source.engine.includes('existingReceipt.value.status === "interrupted"'),
  ],
  [
    "focused test interrupts a dispatch fiber and queries checkpoint",
    source.test.includes("Fiber.interrupt") &&
      source.test.includes("checkpoints interrupted dispatch fibers") &&
      source.test.includes("getInterruptedCommands"),
  ],
];

const failed = checks.filter(([, passed]) => !passed);
if (failed.length > 0) {
  for (const [name] of failed) {
    console.error(`FAIL: ${name}`);
  }
  process.exit(1);
}

console.log("T3 Code #818 interrupt checkpoint checks passed");
