import importlib.util, sys
from pathlib import Path
PATH = Path(__file__).resolve().parents[1] / "fastapi" / "unique_operation_id.py"

def _load():
    name="uniq_op"
    if name in sys.modules: del sys.modules[name]
    spec=importlib.util.spec_from_file_location(name, PATH)
    mod=importlib.util.module_from_spec(spec)
    sys.modules[name]=mod
    spec.loader.exec_module(mod)
    return mod

def test_format_and_uniqueness():
    mod=_load()
    a=mod.build_operation_id(method="GET", path="/users/", function_name="list_users")
    b=mod.build_operation_id(method="POST", path="/api/v1/", function_name="create_item")
    assert a.startswith("get_")
    assert "list_users" in a
    assert b.startswith("post_")
    assert a == mod.sanitize_operation_id(a)
    assert all(c.islower() or c.isdigit() or c=="_" for c in a)
    # same function different routers
    ids=mod.unique_ids_for_routes([
        ("GET","/admin/","list_users"),
        ("GET","/public/","list_users"),
        ("GET","/admin/","list_users"),  # genuine collision
    ])
    assert ids[0] != ids[1]
    assert ids[2] == ids[0] + "_2" or ids[2].endswith("_2")
    print("ALL PASSED", ids)

if __name__=="__main__":
    test_format_and_uniqueness()
