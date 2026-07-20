import { DraftStore } from "./ChatComposerDrafts.ts";
function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}
const s = new DraftStore();
s.save("t1", "hello draft");
assert(s.load("t1") === "hello draft", "save load");
const restored = s.switchThread("t1", "t2", "hello draft v2");
assert(s.load("t1") === "hello draft v2", "saved on switch");
assert(restored === "", "t2 empty");
s.save("t2", "other");
assert(s.switchThread("t2", "t1", "other") === "hello draft v2", "restore t1");
s.clear("t1");
assert(s.load("t1") === "", "cleared after send");
s.save("t3", "   ");
assert(s.size() === 1 && s.load("t3") === "", "empty not stored"); // size may be 1 from t2
// fix: t2 still there
assert(s.load("t2") === "other", "t2 remains");
s.save("t3", "");
assert(s.load("t3") === "", "blank");
console.log("ChatComposerDrafts tests: all passed");
