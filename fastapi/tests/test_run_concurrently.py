"""Tests for run_concurrently in fastapi.concurrency."""
import asyncio
import pytest
from fastapi.concurrency import ConcurrencyError, run_concurrently


@pytest.mark.anyio
async def test_max_concurrency_limit():
    """Coroutines execute with specified concurrency limit."""
    running = 0
    max_seen = 0
    lock = asyncio.Lock()

    async def task():
        nonlocal running, max_seen
        async with lock:
            running += 1
            max_seen = max(max_seen, running)
        await asyncio.sleep(0.05)
        async with lock:
            running -= 1
        return True

    results = await run_concurrently(
        [task() for _ in range(6)],
        max_concurrency=2,
    )
    assert all(results)
    assert max_seen <= 2


@pytest.mark.anyio
async def test_results_order():
    """Results maintain input order regardless of completion order."""
    async def fast():
        await asyncio.sleep(0.01)
        return "fast"

    async def slow():
        await asyncio.sleep(0.1)
        return "slow"

    results = await run_concurrently(
        [fast(), slow()],
        max_concurrency=2,
    )
    assert results == ["fast", "slow"]


@pytest.mark.anyio
async def test_concurrency_error():
    """ConcurrencyError contains all failed task exceptions."""
    async def fail(msg):
        raise ValueError(msg)

    async def ok():
        return "ok"

    with pytest.raises(ConcurrencyError) as exc:
        await run_concurrently(
            [fail("bad1"), ok(), fail("bad2")],
            max_concurrency=2,
        )
    errors = exc.value.errors
    assert len(errors) == 2
    assert all(isinstance(e, ValueError) for e in errors)


@pytest.mark.anyio
async def test_timeout():
    """Timeout cancels remaining tasks and raises TimeoutError."""
    async def slow():
        await asyncio.sleep(10)

    with pytest.raises(TimeoutError):
        await run_concurrently(
            [slow()],
            max_concurrency=1,
            timeout=0.01,
        )


@pytest.mark.anyio
async def test_max_concurrency_one_sequential():
    """max_concurrency of 1 executes tasks sequentially."""
    order = []

    async def task(n):
        await asyncio.sleep(0.01)
        order.append(n)
        return n

    results = await run_concurrently(
        [task(1), task(2), task(3)],
        max_concurrency=1,
    )
    assert results == [1, 2, 3]
    assert order == [1, 2, 3]


@pytest.mark.anyio
async def test_max_concurrency_exceeds_count():
    """max_concurrency greater than task count runs all at once."""
    start_count = [0]
    done = asyncio.Event()

    async def task():
        start_count[0] += 1
        if start_count[0] == 3:
            done.set()
        await done.wait()
        return True

    results = await run_concurrently(
        [task() for _ in range(3)],
        max_concurrency=10,
    )
    assert all(results)