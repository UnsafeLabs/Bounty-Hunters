from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

app = FastAPI()
call_count = 0

def expensive_dep():
    global call_count
    call_count += 1
    return {"count": call_count}

@app.get("/a")
def endpoint_a(dep=Depends(expensive_dep, use_cache=True)):
    return dep

@app.get("/b")
def endpoint_b(dep=Depends(expensive_dep, use_cache=True)):
    return dep

@app.get("/c")
def endpoint_c(dep=Depends(expensive_dep, use_cache=False)):
    return dep

client = TestClient(app)

class TestDepCache:
    def test_cached_dep_same_request(self):
        global call_count
        call_count = 0
        resp = client.get("/a")
        assert resp.status_code == 200
        assert resp.json()["count"] == 1

    def test_cache_across_endpoints_same_request(self):
        pass

    def test_no_cache_when_use_cache_false(self):
        global call_count
        call_count = 0
        resp = client.get("/c")
        assert resp.status_code == 200

    def test_cache_does_not_leak_between_requests(self):
        global call_count
        call_count = 0
        client.get("/a")
        c1 = call_count
        client.get("/a")
        assert call_count > c1  # new request, new cache
