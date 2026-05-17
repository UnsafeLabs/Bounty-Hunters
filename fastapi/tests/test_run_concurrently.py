import asyncio
import pytest
from fastapi.concurrency import run_concurrently, ConcurrencyError

@pytest.mark.anyio
async def test_max_concurrency_limit():
    import asyncio
    active = 0
    max_active = 0
    lock = asyncio.Lock()
    async def task():
        nonlocal active, max_active
        async with lock:
            active += 1
            max_active = max(max_active, active)
            await asyncio.sleep(0.05)
            active -= 1
        return True
    results = await run_concurrently([task() for _ in range(5)], max_concurrency=2)
    assert max_active <= 2
    assert len(results) == 5

@pytest.mark.anyio
async def test_results_order():
    async def task(n):
        await asyncio.sleep(0.01 * (5 - n))
        return n
    results = await run_concurrently([task(i) for i in range(5)], max_concurrency=5)
    assert results == list(range(5))

@pytest.mark.anyio
async def test_concurrency_error():
    async def fail(msg):
        raise ValueError(msg)
    async def ok():
        return "ok"
    with pytest.raises(ConcurrencyError) as exc:
        await run_concurrently([fail("bad1"), ok(), fail("bad2")], max_concurrency=2)
    assert len(exc.value.errors) == 2

@pytest.mark.anyio
async def test_timeout():
    async def slow():
        await asyncio.sleep(10)
    with pytest.raises(TimeoutError):
        await run_concurrently([slow()], max_concurrency=1, timeout=0.01)

@pytest.mark.anyio
async def test_max_concurrency_one_sequential():
    order = []
    async def task(n):
        await asyncio.sleep(0.01)
        order.append(n)
        return n
    results = await run_concurrently([task(1), task(2), task(3)], max_concurrency=1)
    assert results == [1, 2, 3]
    assert order == [1, 2, 3]

@pytest.mark.anyio
async def test_max_concurrency_exceeds_count():
    done = asyncio.Event()
    started = []
    async def task():
        started.append(1)
        if len(started) == 3:
            done.set()
        await done.wait()
        return True
    results = await run_concurrently([task() for _ in range(3)], max_concurrency=10)
    assert all(results)
