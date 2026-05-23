import asyncio
import pytest
from fastapi.concurrency import run_concurrently, ConcurrencyError

@pytest.mark.asyncio
async def test_run_concurrently_ordering():
    async def task(delay, result):
        await asyncio.sleep(delay)
        return result

    coroutines = [
        task(0.3, "first"),
        task(0.1, "second"),
        task(0.2, "third"),
    ]
    results = await run_concurrently(coroutines, max_concurrency=3)
    assert results == ["first", "second", "third"]

@pytest.mark.asyncio
async def test_run_concurrently_limiting():
    active_tasks = 0
    max_active = 0

    async def task():
        nonlocal active_tasks, max_active
        active_tasks += 1
        max_active = max(max_active, active_tasks)
        await asyncio.sleep(0.1)
        active_tasks -= 1
        return "done"

    coroutines = [task() for _ in range(5)]
    results = await run_concurrently(coroutines, max_concurrency=2)
    assert max_active == 2
    assert results == ["done"] * 5

@pytest.mark.asyncio
async def test_run_concurrently_error_collection():
    async def success_task():
        return "ok"

    async def fail_task(msg):
        raise ValueError(msg)

    coroutines = [
        success_task(),
        fail_task("error 1"),
        success_task(),
        fail_task("error 2"),
    ]
    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(coroutines, max_concurrency=2)
    
    assert len(exc_info.value.exceptions) == 2
    assert str(exc_info.value.exceptions[0]) == "error 1"
    assert str(exc_info.value.exceptions[1]) == "error 2"

@pytest.mark.asyncio
async def test_run_concurrently_timeout():
    async def slow_task(index):
        await asyncio.sleep(0.5)
        return index

    async def fast_task(index):
        await asyncio.sleep(0.1)
        return index

    coroutines = [fast_task(0), slow_task(1), fast_task(2)]
    results, err = await run_concurrently(coroutines, max_concurrency=3, timeout=0.3)
    
    assert isinstance(err, asyncio.TimeoutError)
    assert results[0] == 0
    assert results[1] is None
    assert results[2] == 2
