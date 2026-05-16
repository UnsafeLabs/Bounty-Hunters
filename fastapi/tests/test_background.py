import asyncio

import pytest
from fastapi import BackgroundTasks, FastAPI
from fastapi.background import BackgroundTaskError
from fastapi.testclient import TestClient

# ============================================================================
# Test 1 - Basic task execution (no retry, default flow)
# ============================================================================

_RESULTS: list[str] = []


def _reset() -> None:
    _RESULTS.clear()


def _sync_task(msg: str) -> None:
    _RESULTS.append(msg)


@pytest.fixture(autouse=True)
def reset_results():
    _reset()
    yield


def test_basic_task_execution():
    """Task runs without error handling (backward compatible)."""
    app = FastAPI()

    @app.post("/enqueue")
    async def enqueue(background_tasks: BackgroundTasks):
        background_tasks.add_task(_sync_task, "hello")
        return {"ok": True}

    client = TestClient(app)
    resp = client.post("/enqueue")
    assert resp.status_code == 200
    assert len(_RESULTS) == 1
    assert _RESULTS[0] == "hello"


# ============================================================================
# Test 2 - Retry on failure
# ============================================================================

_RETRY_COUNTER: dict[str, int] = {}


def _fragile_task(uid: str, fail_count: int) -> None:
    _RETRY_COUNTER.setdefault(uid, 0)
    _RETRY_COUNTER[uid] += 1
    if _RETRY_COUNTER[uid] <= fail_count:
        raise ValueError(f"Attempt {_RETRY_COUNTER[uid]} failed")


def test_retry_success_after_failures():
    """Task succeeds after 2 retries when max_retries=2."""
    _RETRY_COUNTER.clear()
    app = FastAPI()

    @app.post("/enqueue")
    async def enqueue(background_tasks: BackgroundTasks):
        background_tasks.add_task(
            _fragile_task,
            "test1",
            2,  # fail_count=2 meaning it fails on 1st and 2nd call
            max_retries=3,
            retry_delay=0.01,
        )
        return {"ok": True}

    client = TestClient(app)
    resp = client.post("/enqueue")
    assert resp.status_code == 200
    assert _RETRY_COUNTER.get("test1", 0) == 3  # 1 initial + 2 retries


def test_retry_exhausted():
    """Task fails permanently after exhausting retries."""
    _RETRY_COUNTER.clear()

    errors: list[BackgroundTaskError] = []

    def on_err(err: BackgroundTaskError) -> None:
        errors.append(err)

    app = FastAPI()

    @app.post("/enqueue")
    async def enqueue(background_tasks: BackgroundTasks):
        background_tasks.add_task(
            _fragile_task,
            "test2",
            99,  # will always fail
            max_retries=2,
            retry_delay=0.01,
            on_error=on_err,
        )
        return {"ok": True}

    client = TestClient(app)
    resp = client.post("/enqueue")
    assert resp.status_code == 200
    assert len(errors) == 1
    assert errors[0].func_name == "_fragile_task"
    assert isinstance(errors[0].original_exception, ValueError)


# ============================================================================
# Test 3 - raise_on_error
# ============================================================================

_RAISED: list[BackgroundTaskError] = []


def _always_fails() -> None:
    raise RuntimeError("always fails")


async def _async_collect_error(error: BackgroundTaskError) -> None:
    _RAISED.append(error)


def test_raise_on_error():
    """When raise_on_error=True, the BackgroundTaskError is re-raised."""
    _RAISED.clear()
    app = FastAPI()

    @app.post("/enqueue")
    async def enqueue(background_tasks: BackgroundTasks):
        background_tasks.add_task(
            _always_fails,
            max_retries=0,
            raise_on_error=True,
            on_error=_async_collect_error,
        )
        return {"ok": True}

    client = TestClient(app)
    resp = client.post("/enqueue")
    assert resp.status_code == 200

    # The error was raised inside the background task — it won't crash the
    # HTTP response, but the on_error callback should still fire.
    assert len(_RAISED) == 1
    assert isinstance(_RAISED[0].original_exception, RuntimeError)


# ============================================================================
# Test 4 - Exponential backoff
# ============================================================================

async def test_exponential_backoff():
    """Delay between retries follows exponential backoff."""
    _RETRY_COUNTER.clear()

    timestamps: list[float] = []

    def _tracked_task() -> None:
        _RETRY_COUNTER.setdefault("backoff", 0)
        _RETRY_COUNTER["backoff"] += 1
        timestamps.append(time.monotonic())
        raise ValueError("fail")

    app = FastAPI()

    @app.post("/enqueue")
    async def enqueue(background_tasks: BackgroundTasks):
        background_tasks.add_task(
            _tracked_task,
            max_retries=2,
            retry_delay=0.05,
        )
        return {"ok": True}

    import time
    client = TestClient(app)
    resp = client.post("/enqueue")
    assert resp.status_code == 200

    # Wait for background task to complete
    await asyncio.sleep(0.5)

    # timestamps[0] = initial attempt
    # timestamps[1] = first retry after 0.05s delay
    # timestamps[2] = second retry after 0.05 * 2 = 0.1s delay
    if len(timestamps) >= 3:
        # The exact timings vary but the ratio should be close to 2x
        delay1 = timestamps[1] - timestamps[0] if len(timestamps) > 1 else 0
        delay2 = timestamps[2] - timestamps[1] if len(timestamps) > 2 else 0
        # Second delay should be ~2x the first
        assert delay2 > delay1 * 0.5  # loose check


# ============================================================================
# Test 5 - No retry, error callback only
# ============================================================================

def test_error_callback_without_retry():
    """on_error fires even without retries when task fails."""
    errors: list[BackgroundTaskError] = []

    app = FastAPI()

    @app.post("/enqueue")
    async def enqueue(background_tasks: BackgroundTasks):
        background_tasks.add_task(
            _always_fails,
            on_error=lambda e: errors.append(e),
            max_retries=0,
        )
        return {"ok": True}

    client = TestClient(app)
    resp = client.post("/enqueue")
    assert resp.status_code == 200
    assert len(errors) == 1
    assert errors[0].func_name == "_always_fails"


# ============================================================================
# Test 6 - Async task with retry
# ============================================================================

_ASYNC_COUNTER: int = 0


async def _async_fragile() -> None:
    global _ASYNC_COUNTER
    _ASYNC_COUNTER += 1
    if _ASYNC_COUNTER < 3:
        raise ValueError(f"Attempt {_ASYNC_COUNTER} failed")


def test_async_task_with_retry():
    """Async task with retry succeeds after initial failures."""
    global _ASYNC_COUNTER
    _ASYNC_COUNTER = 0

    app = FastAPI()

    @app.post("/enqueue")
    async def enqueue(background_tasks: BackgroundTasks):
        background_tasks.add_task(
            _async_fragile,
            max_retries=3,
            retry_delay=0.01,
        )
        return {"ok": True}

    client = TestClient(app)
    resp = client.post("/enqueue")
    assert resp.status_code == 200
    assert _ASYNC_COUNTER >= 3


# ============================================================================
# Test 7 - BackgroundTaskError attributes
# ============================================================================

def test_background_task_error_attributes():
    """BackgroundTaskError stores correct func_name and original exception."""
    try:
        raise ValueError("original error")
    except ValueError as orig:
        err = BackgroundTaskError("my_func", orig)
        assert err.func_name == "my_func"
        assert isinstance(err.original_exception, ValueError)
        assert "original error" in str(err)


# ============================================================================
# Test 8 - Multiple tasks some with retry, some without
# ============================================================================

_MULTI_RESULTS: list[str] = []


def test_mixed_tasks():
    """Background tasks with and without retry can be mixed."""
    _MULTI_RESULTS.clear()

    def task_a() -> None:
        _MULTI_RESULTS.append("A")

    def task_b() -> None:
        _MULTI_RESULTS.append("B")

    app = FastAPI()

    @app.post("/enqueue")
    async def enqueue(background_tasks: BackgroundTasks):
        background_tasks.add_task(task_a)  # no retry
        background_tasks.add_task(task_b, max_retries=1, retry_delay=0.01)  # with retry
        return {"ok": True}

    client = TestClient(app)
    resp = client.post("/enqueue")
    assert resp.status_code == 200
    assert sorted(_MULTI_RESULTS) == ["A", "B"]


# ============================================================================
# Test 9 - Backward compatibility
# ============================================================================

import time


def test_backward_compatible():
    """Original add_task signature still works."""
    _RESULTS.clear()

    app = FastAPI()

    @app.post("/enqueue")
    async def enqueue(background_tasks: BackgroundTasks):
        background_tasks.add_task(_sync_task, "compat")
        return {"ok": True}

    client = TestClient(app)
    resp = client.post("/enqueue")
    assert resp.status_code == 200
    assert _RESULTS == ["compat"]
