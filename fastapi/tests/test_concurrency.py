import asyncio
from collections.abc import Awaitable, Generator

import pytest
from fastapi.concurrency import ConcurrencyError, run_concurrently


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_run_concurrently_preserves_input_order() -> None:
    async def finish_after(delay: float, value: int) -> int:
        await asyncio.sleep(delay)
        return value

    results = await run_concurrently(
        [
            finish_after(0.03, 1),
            finish_after(0.01, 2),
            finish_after(0.02, 3),
        ],
        max_concurrency=3,
    )

    assert results == [1, 2, 3]


@pytest.mark.anyio
async def test_run_concurrently_limits_active_tasks() -> None:
    active_count = 0
    max_seen_active_count = 0

    async def tracked_task(value: int) -> int:
        nonlocal active_count, max_seen_active_count
        active_count += 1
        max_seen_active_count = max(max_seen_active_count, active_count)
        await asyncio.sleep(0.01)
        active_count -= 1
        return value

    results = await run_concurrently(
        [tracked_task(index) for index in range(6)],
        max_concurrency=2,
    )

    assert results == list(range(6))
    assert max_seen_active_count == 2


@pytest.mark.anyio
async def test_run_concurrently_sequential_when_limit_is_one() -> None:
    order: list[int] = []

    async def tracked_task(value: int) -> int:
        order.append(value)
        await asyncio.sleep(0)
        return value

    results = await run_concurrently(
        [tracked_task(1), tracked_task(2), tracked_task(3)],
        max_concurrency=1,
    )

    assert results == [1, 2, 3]
    assert order == [1, 2, 3]


@pytest.mark.anyio
async def test_run_concurrently_allows_limit_above_task_count() -> None:
    results = await run_concurrently(
        [asyncio.sleep(0, result="a"), asyncio.sleep(0, result="b")],
        max_concurrency=10,
    )

    assert results == ["a", "b"]


@pytest.mark.anyio
async def test_run_concurrently_collects_all_task_exceptions() -> None:
    async def fail(message: str) -> None:
        await asyncio.sleep(0)
        raise RuntimeError(message)

    async def succeed() -> str:
        await asyncio.sleep(0)
        return "ok"

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(
            [fail("first"), succeed(), fail("second")],
            max_concurrency=3,
        )

    error = exc_info.value
    assert [str(failure) for failure in error.failures] == ["first", "second"]
    assert error.partial_results == [None, "ok", None]


@pytest.mark.anyio
async def test_run_concurrently_timeout_cancels_remaining_tasks() -> None:
    task_cancelled = asyncio.Event()

    async def fast_task() -> str:
        await asyncio.sleep(0)
        return "done"

    async def slow_task() -> str:
        try:
            await asyncio.sleep(1)
        except asyncio.CancelledError:
            task_cancelled.set()
            raise
        return "too late"

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(
            [fast_task(), slow_task()],
            max_concurrency=2,
            timeout=0.01,
        )

    error = exc_info.value
    assert error.partial_results == ["done", None]
    assert any(isinstance(failure, TimeoutError) for failure in error.failures)
    assert task_cancelled.is_set()


@pytest.mark.anyio
async def test_run_concurrently_timeout_closes_unstarted_awaitables() -> None:
    class CloseAwareAwaitable:
        started = False
        closed = False

        def __await__(self) -> Generator[object, None, str]:
            self.started = True
            return asyncio.sleep(0, result="late").__await__()

        def close(self) -> None:
            self.closed = True

    async def slow_task() -> str:
        await asyncio.sleep(1)
        return "too late"

    pending_awaitable = CloseAwareAwaitable()
    awaitables: list[Awaitable[str]] = [slow_task(), pending_awaitable]

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(
            awaitables,
            max_concurrency=1,
            timeout=0.01,
        )

    assert exc_info.value.partial_results == [None, None]
    assert pending_awaitable.started is False
    assert pending_awaitable.closed is True


def test_run_concurrently_rejects_invalid_concurrency_limit() -> None:
    with pytest.raises(ValueError, match="max_concurrency"):
        asyncio.run(run_concurrently([], max_concurrency=0))
