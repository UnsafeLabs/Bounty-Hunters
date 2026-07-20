from pathlib import Path
import importlib.util, sys
PATH = Path(__file__).resolve().parents[1] / "fastapi" / "upload_validation.py"

def _load():
    name="upload_val_local"
    if name in sys.modules: del sys.modules[name]
    spec=importlib.util.spec_from_file_location(name, PATH)
    mod=importlib.util.module_from_spec(spec)
    sys.modules[name]=mod
    spec.loader.exec_module(mod)
    return mod

def test_size_and_type():
    mod=_load()
    ok=mod.validate_upload(file_size=10, content_type="image/png", max_size=100)
    assert ok.is_valid
    big=mod.validate_upload(file_size=200, content_type="image/png", max_size=100)
    assert not big.is_valid and big.status_code==413
    bad=mod.validate_upload(file_size=10, content_type="application/exe", allowed_content_types=["image/png"])
    assert not bad.is_valid and bad.status_code==415
    free=mod.validate_upload(file_size=10**9, content_type="x", max_size=None, allowed_content_types=None)
    assert free.is_valid
    try:
        mod.enforce_upload_constraints(file_size=200, content_type="a", max_size=100)
        assert False
    except mod.UploadValidationError as e:
        assert e.status_code==413

if __name__=="__main__":
    test_size_and_type(); print("ALL PASSED")
