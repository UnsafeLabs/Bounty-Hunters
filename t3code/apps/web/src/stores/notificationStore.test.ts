import { NotificationStore, TYPE_STYLE } from "./notificationStore.ts";
function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}
let t = 1000;
const s = new NotificationStore(() => t);
const a = s.addNotification("success", "pushed");
assert(a.type === "success" && TYPE_STYLE.success.color, "type");
s.addNotification("error", "fail", 1000);
assert(s.getActive().length === 2, "stack");
s.dismiss(a.id);
assert(s.getActive().length === 1, "dismiss");
t += 2000;
s.tick();
assert(s.getActive().length === 0, "auto dismiss");
assert(s.getHistory().length === 2, "history");
s.clearHistory();
assert(s.getHistory().length === 0, "clear");
// history cap
for (let i = 0; i < 60; i++) s.addNotification("info", String(i));
assert(s.getHistory().length === 50, "cap 50");
console.log("notificationStore tests: all passed");
