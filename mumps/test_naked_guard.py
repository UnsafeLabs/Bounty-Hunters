"""Model of fully-qualified global sets and $DATA#2 (issue #562)."""

class Global:
    def __init__(self):
        self.data = {}  # path -> value
        self.desc = set()  # paths that only have descendants

    def set(self, path, value):
        self.data[path] = value

    def data_mod2(self, path):
        # 1 if has data, 0 if missing, ignore phantom descendants-only
        return 1 if path in self.data else 0

def cert(g, node):
    if not node:
        g.set(("CERT","ERR"), 1)
        return 0
    if g.data_mod2(("CERT", node)):
        g.set(("CERT","CUR"), node)
        g.set(("CERT","OK"), 1)
        return 1
    g.set(("CERT","CUR"), "")
    g.set(("CERT","OK"), 0)
    return 0

g = Global()
g.set(("CERT","ABC"), "x")
assert cert(g, "ABC") == 1
assert cert(g, "MISSING") == 0
# phantom descendant only
g.desc.add(("CERT","PHANTOM"))
assert g.data_mod2(("CERT","PHANTOM")) == 0
print("MUMPS naked guard tests: ALL PASSED")
