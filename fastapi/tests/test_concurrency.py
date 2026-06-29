import asyncio

import pytest
from fastapi.concurrency import ConcurrencyError, run_concurrently


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_run_concurrently_limits_active_tasks() -> None:
    active = 0
    max_seen = 0

    async def task() -> str:
        nonlocal active, max_seen
        active += 1
        max_seen = max(max_seen, active)
        await asyncio.sleep(0.01)
        active -= 1
        return "done"

    results = await run_concurrently([task() for _ in range(5)], max_concurrency=2)

    assert results == ["done"] * 5
    assert max_seen == 2


@pytest.mark.anyio
async def test_run_concurrently_preserves_input_order() -> None:
    async def task(value: int, delay: float) -> int:
        await asyncio.sleep(delay)
        return value

    results = await run_concurrently(
        [
            task(0, 0.03),
            task(1, 0.01),
            task(2, 0.02),
        ],
        max_concurrency=3,
    )

    assert results == [0, 1, 2]


@pytest.mark.anyio
async def test_run_concurrently_collects_all_failures() -> None:
    async def fail(message: str) -> str:
        raise RuntimeError(message)

    async def succeed() -> str:
        return "ok"

    with pytest.raises(ConcurrencyError) as error:
        await run_concurrently(
            [fail("first"), succeed(), fail("second")],
            max_concurrency=3,
        )

    assert [str(failure) for failure in error.value.failures] == ["first", "second"]
    assert error.value.partial_results == [None, "ok", None]


@pytest.mark.anyio
async def test_run_concurrently_timeout_cancels_remaining_tasks() -> None:
    cancelled = False

    async def fast() -> str:
        await asyncio.sleep(0.01)
        return "fast"

    async def slow() -> str:
        nonlocal cancelled
        try:
            await asyncio.sleep(1)
            return "slow"
        except asyncio.CancelledError:
            cancelled = True
            raise

    with pytest.raises(ConcurrencyError) as error:
        await run_concurrently([fast(), slow()], max_concurrency=2, timeout=0.05)

    assert error.value.partial_results == ["fast", None]
    assert any(isinstance(failure, TimeoutError) for failure in error.value.failures)
    assert cancelled


@pytest.mark.anyio
async def test_run_concurrently_sequential_with_single_concurrency() -> None:
    active = 0
    max_seen = 0

    async def task(value: int) -> int:
        nonlocal active, max_seen
        active += 1
        max_seen = max(max_seen, active)
        await asyncio.sleep(0.01)
        active -= 1
        return value

    results = await run_concurrently([task(1), task(2), task(3)], max_concurrency=1)

    assert results == [1, 2, 3]
    assert max_seen == 1


@pytest.mark.anyio
async def test_run_concurrently_all_at_once_when_limit_exceeds_task_count() -> None:
    active = 0
    max_seen = 0

    async def task() -> str:
        nonlocal active, max_seen
        active += 1
        max_seen = max(max_seen, active)
        await asyncio.sleep(0.01)
        active -= 1
        return "done"

    results = await run_concurrently([task() for _ in range(3)], max_concurrency=10)

    assert results == ["done", "done", "done"]
    assert max_seen == 3


@pytest.mark.anyio
async def test_run_concurrently_rejects_invalid_concurrency() -> None:
    async def task() -> str:
        return "done"

    with pytest.raises(ValueError):
        await run_concurrently([task()], max_concurrency=0)
