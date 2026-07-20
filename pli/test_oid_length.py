"""OID_STRING length guard model (issue #566)."""

def append_oid(oid, arc, maxlen=256):
    arc_str = str(arc)
    need = len(arc_str) + (1 if oid else 0)
    if len(oid) + need > maxlen:
        return oid, "overflow"
    if not oid:
        return arc_str, "ok"
    return oid + "." + arc_str, "ok"

oid = ""
status = "ok"
for arc in [1, 2, 840, 113549, 1, 1, 11]:
    oid, status = append_oid(oid, arc)
assert status == "ok"
# force overflow with huge synthetic
oid2 = "1" * 250
oid2, status = append_oid(oid2, 123456789)
assert status == "overflow"
# cycle detect
seen = set()
def walk(nodes, start):
    cur = start
    while cur is not None:
        if cur in seen:
            return "cycle"
        seen.add(cur)
        cur = nodes.get(cur)
    return "ok"
assert walk({1: 2, 2: 3, 3: 1}, 1) == "cycle"
print("PL/I OID/cycle tests: ALL PASSED")
