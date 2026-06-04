import asyncio

import pytest

from fastapi.concurrency import ConcurrencyError, run_concurrently


@pytest.mark.anyio
async def test_run_concurrently_preserves_input_order() -> None:
    async def worker(index: int) -> int:
        await asyncio.sleep(0.02 - index * 0.003)
        return index

    result = await run_concurrently(
        [worker(0), worker(1), worker(2), worker(3)],
        max_concurrency=2,
    )

    assert result == [0, 1, 2, 3]


@pytest.mark.anyio
async def test_run_concurrently_obeys_max_concurrency_of_one() -> None:
    active = 0
    max_active = 0

    async def worker() -> int:
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.01)
        active -= 1
        return 1

    await run_concurrently(
        [worker(), worker(), worker(), worker()],
        max_concurrency=1,
    )

    assert max_active == 1


@pytest.mark.anyio
async def test_run_concurrently_runs_all_when_pool_large() -> None:
    active = 0
    max_active = 0

    async def worker() -> int:
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.01)
        active -= 1
        return 1

    await run_concurrently(
        [worker(), worker(), worker()],
        max_concurrency=10,
    )

    assert max_active == 3


@pytest.mark.anyio
async def test_run_concurrently_raises_with_collected_failures() -> None:
    async def success(value: int) -> int:
        await asyncio.sleep(0.01)
        return value

    async def fail(value: int) -> int:
        await asyncio.sleep(0.005)
        raise RuntimeError(f"fail-{value}")

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(
            [success(1), fail(2), success(3)],
            max_concurrency=2,
        )

    assert len(exc_info.value.failures) == 1
    assert isinstance(exc_info.value.failures[0], RuntimeError)
    assert exc_info.value.partial_results == [1, 3]


@pytest.mark.anyio
async def test_run_concurrently_cancels_and_reports_timeout() -> None:
    cancelled = 0

    async def slow_task() -> int:
        nonlocal cancelled
        try:
            await asyncio.sleep(0.2)
        except asyncio.CancelledError:
            cancelled += 1
            raise
        return 1

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(
            [slow_task(), slow_task()],
            max_concurrency=2,
            timeout=0.01,
        )

    assert any(isinstance(exc, asyncio.TimeoutError) for exc in exc_info.value.failures)
    assert cancelled == 2
    assert exc_info.value.partial_results == []
