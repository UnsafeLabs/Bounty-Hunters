from fastapi import Depends, FastAPI, Security
from fastapi.testclient import TestClient

app = FastAPI()

counter_holder = {"counter": 0}


async def dep_counter():
    counter_holder["counter"] += 1
    return counter_holder["counter"]


def sync_dep_counter():
    counter_holder["counter"] += 1
    return counter_holder["counter"]


async def super_dep(count: int = Depends(dep_counter)):
    return count


@app.get("/counter/")
async def get_counter(count: int = Depends(dep_counter)):
    return {"counter": count}


@app.get("/sync-counter/")
async def get_sync_counter(
    first: int = Depends(sync_dep_counter),
    second: int = Depends(sync_dep_counter),
):
    return {"first": first, "second": second}


@app.get("/sub-counter/")
async def get_sub_counter(
    subcount: int = Depends(super_dep), count: int = Depends(dep_counter)
):
    return {"counter": count, "subcounter": subcount}


@app.get("/sub-counter-no-cache/")
async def get_sub_counter_no_cache(
    subcount: int = Depends(super_dep),
    count: int = Depends(dep_counter, use_cache=False),
):
    return {"counter": count, "subcounter": subcount}


@app.get("/sub-counter-no-cache-first/")
async def get_sub_counter_no_cache_first(
    count: int = Depends(dep_counter, use_cache=False),
    subcount: int = Depends(super_dep),
):
    return {"counter": count, "subcounter": subcount}


@app.get(
    "/decorator-dependency-no-cache/",
    dependencies=[
        Depends(dep_counter, use_cache=False),
        Depends(dep_counter, use_cache=False),
    ],
)
async def get_decorator_dependency_no_cache():
    return {"counter": counter_holder["counter"]}


@app.get("/scope-counter")
async def get_scope_counter(
    count: int = Security(dep_counter),
    scope_count_1: int = Security(dep_counter, scopes=["scope"]),
    scope_count_2: int = Security(dep_counter, scopes=["scope"]),
):
    return {
        "counter": count,
        "scope_counter_1": scope_count_1,
        "scope_counter_2": scope_count_2,
    }


client = TestClient(app)


def test_normal_counter():
    counter_holder["counter"] = 0
    response = client.get("/counter/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 1}
    response = client.get("/counter/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 2}


def test_sync_counter():
    counter_holder["counter"] = 0
    response = client.get("/sync-counter/")
    assert response.status_code == 200, response.text
    assert response.json() == {"first": 1, "second": 1}
    response = client.get("/sync-counter/")
    assert response.status_code == 200, response.text
    assert response.json() == {"first": 2, "second": 2}


def test_sub_counter():
    counter_holder["counter"] = 0
    response = client.get("/sub-counter/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 1, "subcounter": 1}
    response = client.get("/sub-counter/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 2, "subcounter": 2}


def test_sub_counter_no_cache():
    counter_holder["counter"] = 0
    response = client.get("/sub-counter-no-cache/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 2, "subcounter": 1}
    response = client.get("/sub-counter-no-cache/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 4, "subcounter": 3}


def test_sub_counter_no_cache_first():
    counter_holder["counter"] = 0
    response = client.get("/sub-counter-no-cache-first/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 1, "subcounter": 2}
    response = client.get("/sub-counter-no-cache-first/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 3, "subcounter": 4}


def test_decorator_dependency_no_cache():
    counter_holder["counter"] = 0
    response = client.get("/decorator-dependency-no-cache/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 2}
    response = client.get("/decorator-dependency-no-cache/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 4}


def test_security_cache():
    counter_holder["counter"] = 0
    response = client.get("/scope-counter/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 1, "scope_counter_1": 2, "scope_counter_2": 2}
    response = client.get("/scope-counter/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 3, "scope_counter_1": 4, "scope_counter_2": 4}
