import asyncio

import pytest
from fastapi.concurrency import ConcurrencyError, run_concurrently

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


async def test_run_concurrently_preserves_input_order() -> None:
    async def delayed(value: int, delay: float) -> int:
        await asyncio.sleep(delay)
        return value

    results = await run_concurrently(
        [
            delayed(1, 0.03),
            delayed(2, 0.01),
            delayed(3, 0.02),
        ],
        max_concurrency=3,
    )

    assert results == [1, 2, 3]


async def test_run_concurrently_limits_concurrency() -> None:
    active = 0
    max_active = 0

    async def track_active(value: int) -> int:
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.01)
        active -= 1
        return value

    results = await run_concurrently(
        [track_active(value) for value in range(6)],
        max_concurrency=2,
    )

    assert results == list(range(6))
    assert max_active == 2


async def test_run_concurrently_max_concurrency_one_runs_sequentially() -> None:
    order: list[str] = []

    async def record(value: str) -> str:
        order.append(f"start-{value}")
        await asyncio.sleep(0.01)
        order.append(f"end-{value}")
        return value

    results = await run_concurrently(
        [record("a"), record("b"), record("c")],
        max_concurrency=1,
    )

    assert results == ["a", "b", "c"]
    assert order == ["start-a", "end-a", "start-b", "end-b", "start-c", "end-c"]


async def test_run_concurrently_collects_all_failures() -> None:
    async def fail(message: str) -> str:
        await asyncio.sleep(0)
        raise RuntimeError(message)

    async def succeed() -> str:
        return "ok"

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(
            [fail("first"), succeed(), fail("second")],
            max_concurrency=3,
        )

    error = exc_info.value
    assert [str(exc) for exc in error.exceptions] == ["first", "second"]
    assert error.partial_results == [None, "ok", None]


async def test_run_concurrently_timeout_cancels_remaining_tasks() -> None:
    cancelled = asyncio.Event()

    async def quick() -> str:
        await asyncio.sleep(0.01)
        return "done"

    async def slow() -> str:
        try:
            await asyncio.sleep(1)
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return "late"

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently([quick(), slow()], max_concurrency=2, timeout=0.05)

    error = exc_info.value
    assert error.partial_results == ["done", None]
    assert any(isinstance(exc, asyncio.TimeoutError) for exc in error.exceptions)
    assert cancelled.is_set()


async def test_run_concurrently_rejects_invalid_concurrency() -> None:
    async def noop() -> None:
        return None

    with pytest.raises(ValueError, match="max_concurrency"):
        await run_concurrently([noop()], max_concurrency=0)
