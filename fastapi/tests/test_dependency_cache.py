from fastapi import Depends, FastAPI, Security
from fastapi.testclient import TestClient

app = FastAPI()

counter_holder = {"counter": 0}


async def dep_counter():
    counter_holder["counter"] += 1
    return counter_holder["counter"]


async def super_dep(count: int = Depends(dep_counter)):
    return count


@app.get("/counter/")
async def get_counter(count: int = Depends(dep_counter)):
    return {"counter": count}


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


@app.get("/decorator-counter-no-cache/", dependencies=[Depends(dep_counter, use_cache=False)])
async def get_decorator_counter_no_cache(count: int = Depends(dep_counter)):
    return {"counter": count}


async def async_dep_counter():
    counter_holder["counter"] += 1
    return counter_holder["counter"]


async def async_super_dep(count: int = Depends(async_dep_counter)):
    return count


@app.get("/async-sub-counter/")
async def get_async_sub_counter(
    subcount: int = Depends(async_super_dep), count: int = Depends(async_dep_counter)
):
    return {"counter": count, "subcounter": subcount}


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


def test_no_cache_dependency_does_not_seed_later_cached_dependency():
    counter_holder["counter"] = 0
    response = client.get("/sub-counter-no-cache-first/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 1, "subcounter": 2}
    response = client.get("/sub-counter-no-cache-first/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 3, "subcounter": 4}


def test_parameterless_no_cache_dependency_does_not_seed_cache():
    counter_holder["counter"] = 0
    response = client.get("/decorator-counter-no-cache/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 2}
    response = client.get("/decorator-counter-no-cache/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 4}


def test_async_dependency_cache_is_request_scoped():
    counter_holder["counter"] = 0
    response = client.get("/async-sub-counter/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 1, "subcounter": 1}
    response = client.get("/async-sub-counter/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 2, "subcounter": 2}


def test_security_cache():
    counter_holder["counter"] = 0
    response = client.get("/scope-counter/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 1, "scope_counter_1": 2, "scope_counter_2": 2}
    response = client.get("/scope-counter/")
    assert response.status_code == 200, response.text
    assert response.json() == {"counter": 3, "scope_counter_1": 4, "scope_counter_2": 4}
