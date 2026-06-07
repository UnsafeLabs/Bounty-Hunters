import { readFileSync } from "node:fs";

const checks = [
  {
    file: "apps/desktop/src/settings/DesktopSavedEnvironments.ts",
    patterns: [
      "currentKeyVersion",
      "encryptedBearerTokenKeyVersion",
      "rotateKeys",
      "safeStorage.generateEncryptionKeyVersion",
      "decodeSecretBytes(record.encryptedBearerToken)",
      "writeDocument({",
      "desktop saved environment key rotation completed",
    ],
  },
  {
    file: "apps/desktop/src/settings/DesktopSavedEnvironments.test.ts",
    patterns: [
      "re-encrypts saved environment secrets with a new key version",
      "keeps old encrypted secrets accessible when rotation encryption fails",
      "encryptErrorAfterSuccesses: 1",
    ],
  },
  {
    file: "apps/desktop/src/window/DesktopApplicationMenu.ts",
    patterns: [
      'label: "Developer"',
      'label: "Rotate Encryption Keys..."',
      "Rotate saved environment encryption keys?",
      "savedEnvironments.rotateKeys",
    ],
  },
  {
    file: "apps/desktop/src/ipc/methods/savedEnvironments.ts",
    patterns: ["rotateSavedEnvironmentKeys", "ROTATE_SAVED_ENVIRONMENT_KEYS_CHANNEL"],
  },
  {
    file: "apps/desktop/src/preload.ts",
    patterns: ["rotateSavedEnvironmentKeys", "ROTATE_SAVED_ENVIRONMENT_KEYS_CHANNEL"],
  },
  {
    file: "packages/contracts/src/ipc.ts",
    patterns: ["SavedEnvironmentKeyRotationResult", "rotateSavedEnvironmentKeys"],
  },
  {
    file: "apps/desktop/src/.audit.json",
    patterns: ["Codex GPT-5", "Public redacted audit metadata only"],
  },
];

for (const check of checks) {
  const source = readFileSync(check.file, "utf8");
  for (const pattern of check.patterns) {
    if (!source.includes(pattern)) {
      throw new Error(`${check.file} is missing ${pattern}`);
    }
  }
}

console.log("t3 key rotation checks passed");
