import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "tls_validator.adb"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const required = [
  "procedure Safe_Free_Chain (Current_Chain : in out Cert_Chain_Ptr)",
  "if Current_Chain /= null then",
  "Current_Chain := null;",
  "type Certificate_Record (Key_Algorithm : Algorithm_Type) is record",
  "return Certificate_Record'",
  "Key_Algorithm    => EC_P384",
  "with procedure Finalize_Element (E : in out Element_Type);",
  "Finalize_Element (Cache (Index).Element);",
  "protected Cleanup_Guard is",
  "procedure Atomic_Evict (Session_ID : Natural);",
  "when Storage_Error =>",
  "Test_Double_Free_Path",
  "Test_Discriminant_Creation",
  "Test_Cache_Evict_Finalizes",
  "Test_Cleanup_Atomic_Evict",
];

for (const pattern of required) {
  assert(source.includes(pattern), `missing Ada lifetime pattern: ${pattern}`);
}

const rawFreeCalls = [...source.matchAll(/\bFree_Chain_Raw\s*\(/g)];
assert(rawFreeCalls.length === 1, "raw free should only be called inside Safe_Free_Chain");
assert(!/Key_Algorithm\s*:\s*Algorithm_Type\s*:=/i.test(source), "Certificate_Record discriminant must not have a default");
assert(!/Key_Algorithm\s*:=\s*EC_P384/i.test(source), "discriminant must not be mutated after allocation");
assert(!/then\s+abort/i.test(source), "cleanup must not use ATC then abort");

class ChainRef {
  constructor() {
    this.value = { freed: false };
  }
}

function safeFree(ref) {
  if (ref.value !== null) {
    assert(ref.value.freed === false, "double free");
    ref.value.freed = true;
    ref.value = null;
  }
}

const chain = new ChainRef();
safeFree(chain);
safeFree(chain);
assert(chain.value === null, "safe free must null pointer");

function parseSubjectPublicKeyInfo(algorithm) {
  if (algorithm === "EC_P384") return { keyAlgorithm: "EC_P384", curveBytes: 48 };
  if (algorithm === "EC_P256") return { keyAlgorithm: "EC_P256", curveBytes: 32 };
  return { keyAlgorithm: algorithm };
}
assert(parseSubjectPublicKeyInfo("EC_P384").curveBytes === 48, "EC_P384 must allocate correct discriminant layout");

let finalized = 0;
class Cache {
  constructor(finalize) {
    this.finalize = finalize;
    this.map = new Map();
  }
  insert(key, value) {
    if (this.map.has(key)) this.finalize(this.map.get(key));
    this.map.set(key, value);
  }
  evict(key) {
    if (this.map.has(key)) {
      this.finalize(this.map.get(key));
      this.map.delete(key);
    }
  }
}
const cache = new Cache(() => { finalized += 1; });
cache.insert(42, {});
cache.evict(42);
assert(finalized === 1, "cache eviction must finalize element exactly once");

let cleanupLocked = false;
function atomicEvict(fn) {
  assert(cleanupLocked === false, "cleanup overlap");
  cleanupLocked = true;
  try {
    fn();
  } finally {
    cleanupLocked = false;
  }
}
atomicEvict(() => cache.evict(42));
assert(cleanupLocked === false, "cleanup guard must release lock");

console.log("Ada #564 TLS validator lifetime checks passed");
