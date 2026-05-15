import asyncio
from collections.abc import Awaitable

import pytest
from fastapi.concurrency import ConcurrencyError, run_concurrently


def run(coro: Awaitable[object]) -> object:
    return asyncio.run(coro)


def test_run_concurrently_returns_empty_list_for_empty_input():
    assert run(run_concurrently([])) == []


def test_run_concurrently_preserves_input_order():
    async def value_after_delay(value: int, delay: float) -> int:
        await asyncio.sleep(delay)
        return value

    result = run(
        run_concurrently(
            [
                value_after_delay(1, 0.03),
                value_after_delay(2, 0.01),
                value_after_delay(3, 0.02),
            ],
            max_concurrency=3,
        )
    )

    assert result == [1, 2, 3]


def test_run_concurrently_limits_active_tasks():
    running = 0
    max_seen = 0

    async def track_running() -> int:
        nonlocal max_seen, running
        running += 1
        max_seen = max(max_seen, running)
        await asyncio.sleep(0.01)
        running -= 1
        return running

    result = run(
        run_concurrently(
            [track_running() for _ in range(10)],
            max_concurrency=3,
        )
    )

    assert len(result) == 10
    assert max_seen == 3


def test_run_concurrently_max_concurrency_one_is_sequential():
    running = 0
    max_seen = 0

    async def track_running() -> str:
        nonlocal max_seen, running
        running += 1
        max_seen = max(max_seen, running)
        await asyncio.sleep(0)
        running -= 1
        return "done"

    assert run(
        run_concurrently(
            [track_running() for _ in range(5)],
            max_concurrency=1,
        )
    ) == ["done"] * 5
    assert max_seen == 1


def test_run_concurrently_allows_concurrency_above_task_count():
    started = 0

    async def wait_for_all_tasks() -> int:
        nonlocal started
        started += 1
        while started < 4:
            await asyncio.sleep(0)
        return started

    result = run(
        run_concurrently(
            [wait_for_all_tasks() for _ in range(4)],
            max_concurrency=10,
        )
    )

    assert result == [4, 4, 4, 4]


def test_run_concurrently_collects_all_failures_with_partial_results():
    async def succeed(value: int) -> int:
        await asyncio.sleep(0)
        return value

    async def fail(message: str) -> None:
        await asyncio.sleep(0)
        raise RuntimeError(message)

    with pytest.raises(ConcurrencyError) as exc_info:
        run(
            run_concurrently(
                [
                    succeed(1),
                    fail("first"),
                    succeed(3),
                    fail("second"),
                ],
                max_concurrency=4,
            )
        )

    error = exc_info.value
    assert [str(exc) for exc in error.errors] == ["first", "second"]
    assert error.failures == error.errors
    assert error.results == [1, None, 3, None]


def test_run_concurrently_timeout_cancels_remaining_tasks():
    cancelled = []

    async def complete() -> str:
        await asyncio.sleep(0.01)
        return "complete"

    async def never_complete(index: int) -> str:
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled.append(index)
            raise
        return "never"

    with pytest.raises(ConcurrencyError) as exc_info:
        run(
            run_concurrently(
                [complete(), never_complete(1), never_complete(2)],
                max_concurrency=3,
                timeout=0.05,
            )
        )

    error = exc_info.value
    assert error.results == ["complete", None, None]
    assert any(isinstance(exc, TimeoutError) for exc in error.errors)
    assert sorted(cancelled) == [1, 2]


def test_run_concurrently_rejects_non_positive_concurrency():
    with pytest.raises(ValueError, match="max_concurrency"):
        run(run_concurrently([], max_concurrency=0))
