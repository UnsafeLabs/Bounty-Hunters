import asyncio

import pytest
from fastapi.concurrency import ConcurrencyError, run_concurrently


@pytest.mark.anyio
async def test_run_concurrently_limits_concurrency_and_preserves_order():
    active = 0
    max_seen = 0

    async def task(value):
        nonlocal active, max_seen
        active += 1
        max_seen = max(max_seen, active)
        await asyncio.sleep(0.01 * (4 - value))
        active -= 1
        return value

    results = await run_concurrently([task(1), task(2), task(3)], max_concurrency=2)

    assert results == [1, 2, 3]
    assert max_seen == 2


@pytest.mark.anyio
async def test_run_concurrently_sequential_when_max_concurrency_is_one():
    events = []

    async def task(value):
        events.append(f"start:{value}")
        await asyncio.sleep(0)
        events.append(f"end:{value}")
        return value

    results = await run_concurrently([task(1), task(2)], max_concurrency=1)

    assert results == [1, 2]
    assert events == ["start:1", "end:1", "start:2", "end:2"]


@pytest.mark.anyio
async def test_run_concurrently_collects_all_failures():
    async def fail(message):
        raise RuntimeError(message)

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(
            [fail("first"), fail("second")],
            max_concurrency=2,
        )

    assert [str(error) for error in exc_info.value.failures] == ["first", "second"]


@pytest.mark.anyio
async def test_run_concurrently_timeout_cancels_remaining_and_keeps_partial_results():
    async def fast():
        return "done"

    async def slow():
        await asyncio.sleep(1)
        return "late"

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently([fast(), slow()], max_concurrency=2, timeout=0.01)

    assert exc_info.value.partial_results[0] == "done"
    assert any(isinstance(error, TimeoutError) for error in exc_info.value.failures)


@pytest.mark.anyio
async def test_run_concurrently_allows_concurrency_above_task_count():
    async def task(value):
        return value

    assert await run_concurrently([task(1), task(2)], max_concurrency=10) == [1, 2]
