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

    async def tracked(value: int) -> int:
        nonlocal active, max_seen
        active += 1
        max_seen = max(max_seen, active)
        await asyncio.sleep(0.01)
        active -= 1
        return value

    result = await run_concurrently([tracked(index) for index in range(6)], 2)

    assert result == [0, 1, 2, 3, 4, 5]
    assert max_seen == 2


@pytest.mark.anyio
async def test_run_concurrently_preserves_input_order() -> None:
    async def delayed(value: int, delay: float) -> int:
        await asyncio.sleep(delay)
        return value

    result = await run_concurrently(
        [delayed(1, 0.03), delayed(2, 0.01), delayed(3, 0.02)],
        3,
    )

    assert result == [1, 2, 3]


@pytest.mark.anyio
async def test_run_concurrently_collects_all_failures() -> None:
    async def fail_with(exc: Exception) -> None:
        await asyncio.sleep(0)
        raise exc

    async def succeed() -> str:
        await asyncio.sleep(0)
        return "ok"

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(
            [
                fail_with(ValueError("first")),
                succeed(),
                fail_with(RuntimeError("second")),
            ],
            3,
        )

    error = exc_info.value
    assert [type(exc) for exc in error.failures] == [ValueError, RuntimeError]
    assert error.failed_indices == [0, 2]
    assert error.partial_results == [None, "ok", None]


@pytest.mark.anyio
async def test_run_concurrently_timeout_cancels_remaining_tasks() -> None:
    cancelled = False

    async def quick() -> str:
        await asyncio.sleep(0.01)
        return "done"

    async def slow() -> str:
        nonlocal cancelled
        try:
            await asyncio.sleep(1)
        except asyncio.CancelledError:
            cancelled = True
            raise
        return "late"

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently([quick(), slow()], 2, timeout=0.05)

    error = exc_info.value
    assert any(isinstance(exc, TimeoutError) for exc in error.failures)
    assert error.partial_results == ["done", None]
    assert error.failed_indices == [None]
    assert cancelled is True


@pytest.mark.anyio
async def test_run_concurrently_max_concurrency_one_runs_sequentially() -> None:
    events: list[str] = []

    async def tracked(value: int) -> int:
        events.append(f"start-{value}")
        await asyncio.sleep(0)
        events.append(f"end-{value}")
        return value

    result = await run_concurrently([tracked(1), tracked(2), tracked(3)], 1)

    assert result == [1, 2, 3]
    assert events == ["start-1", "end-1", "start-2", "end-2", "start-3", "end-3"]


@pytest.mark.anyio
async def test_run_concurrently_allows_concurrency_above_task_count() -> None:
    active = 0
    max_seen = 0

    async def tracked(value: int) -> int:
        nonlocal active, max_seen
        active += 1
        max_seen = max(max_seen, active)
        await asyncio.sleep(0.01)
        active -= 1
        return value

    result = await run_concurrently([tracked(1), tracked(2), tracked(3)], 10)

    assert result == [1, 2, 3]
    assert max_seen == 3


@pytest.mark.anyio
async def test_run_concurrently_rejects_invalid_max_concurrency() -> None:
    with pytest.raises(ValueError):
        await run_concurrently([], 0)
