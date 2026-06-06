import asyncio

import pytest
from fastapi.concurrency import ConcurrencyError, run_concurrently


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_run_concurrently_preserves_input_order():
    async def work(value: int, delay: float) -> int:
        await asyncio.sleep(delay)
        return value

    results = await run_concurrently(
        [
            work(1, 0.03),
            work(2, 0.01),
            work(3, 0.02),
        ],
        max_concurrency=3,
    )

    assert results == [1, 2, 3]


@pytest.mark.anyio
async def test_run_concurrently_limits_active_tasks():
    running = 0
    peak_running = 0
    lock = asyncio.Lock()

    async def work() -> int:
        nonlocal running, peak_running
        async with lock:
            running += 1
            peak_running = max(peak_running, running)
        await asyncio.sleep(0.02)
        async with lock:
            running -= 1
        return peak_running

    await run_concurrently([work() for _ in range(5)], max_concurrency=2)

    assert peak_running == 2


@pytest.mark.anyio
async def test_run_concurrently_max_concurrency_one_is_sequential():
    events: list[str] = []

    async def work(value: int) -> int:
        events.append(f"start-{value}")
        await asyncio.sleep(0)
        events.append(f"end-{value}")
        return value

    results = await run_concurrently([work(1), work(2)], max_concurrency=1)

    assert results == [1, 2]
    assert events == ["start-1", "end-1", "start-2", "end-2"]


@pytest.mark.anyio
async def test_run_concurrently_allows_concurrency_greater_than_task_count():
    running = 0
    peak_running = 0
    lock = asyncio.Lock()

    async def work(value: int) -> int:
        nonlocal running, peak_running
        async with lock:
            running += 1
            peak_running = max(peak_running, running)
        await asyncio.sleep(0.01)
        async with lock:
            running -= 1
        return value

    results = await run_concurrently([work(1), work(2)], max_concurrency=10)

    assert results == [1, 2]
    assert peak_running == 2


@pytest.mark.anyio
async def test_run_concurrently_collects_all_failures():
    async def succeed() -> str:
        return "ok"

    async def fail(exc: Exception) -> None:
        raise exc

    first = RuntimeError("first failure")
    second = ValueError("second failure")

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(
            [fail(first), succeed(), fail(second)],
            max_concurrency=3,
        )

    assert exc_info.value.failures == [first, second]
    assert exc_info.value.partial_results == [None, "ok", None]


@pytest.mark.anyio
async def test_run_concurrently_timeout_cancels_remaining_tasks():
    cancelled = asyncio.Event()

    async def quick() -> str:
        return "done"

    async def slow() -> str:
        try:
            await asyncio.sleep(1)
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return "late"

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(
            [quick(), slow()],
            max_concurrency=2,
            timeout=0.05,
        )

    assert any(isinstance(failure, TimeoutError) for failure in exc_info.value.failures)
    assert exc_info.value.partial_results == ["done", None]
    assert cancelled.is_set()


@pytest.mark.anyio
async def test_run_concurrently_rejects_invalid_max_concurrency():
    with pytest.raises(ValueError):
        await run_concurrently([], max_concurrency=0)
