import asyncio
import pytest

from fastapi.concurrency import run_concurrently, ConcurrencyError


async def test_run_concurrently_basic():
    """Test basic concurrent execution with multiple tasks."""

    async def task(x: int) -> int:
        await asyncio.sleep(0.01)
        return x * 2

    coroutines = [task(i) for i in range(5)]
    results = await run_concurrently(coroutines, max_concurrency=3)

    assert results == [0, 2, 4, 6, 8]


async def test_run_concurrently_order_preserved():
    """Test that results maintain input order regardless of completion order."""

    async def task(x: int, delay: float) -> int:
        await asyncio.sleep(delay)
        return x * 10

    # Out of order completion: task 2 finishes first, then task 0, then task 1
    coroutines = [task(2, 0.01), task(0, 0.03), task(1, 0.02)]
    results = await run_concurrently(coroutines, max_concurrency=3)

    # Results should be in input order: [20, 0, 10]
    assert results == [20, 0, 10]


async def test_run_concurrently_concurrency_limit():
    """Test that max_concurrency limits simultaneous execution."""

    active = 0
    max_active = 0

    async def task(delay: float) -> str:
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(delay)
        active -= 1
        return "done"

    # Run 10 tasks with max_concurrency=3
    coroutines = [task(0.05) for _ in range(10)]
    results = await run_concurrently(coroutines, max_concurrency=3)

    assert len(results) == 10
    assert all(r == "done" for r in results)
    assert max_active == 3  # Never more than 3 concurrent


async def test_run_concurrently_sequential():
    """Test max_concurrency=1 runs sequentially."""

    results = []

    async def task(x: int) -> int:
        results.append(f"start-{x}")
        await asyncio.sleep(0.01)
        results.append(f"end-{x}")
        return x

    coroutines = [task(i) for i in range(3)]
    await run_concurrently(coroutines, max_concurrency=1)

    # Should execute sequentially: start-0, end-0, start-1, end-1, start-2, end-2
    assert results == [
        "start-0", "end-0",
        "start-1", "end-1",
        "start-2", "end-2",
    ]


async def test_run_concurrently_error_collection():
    """Test that all exceptions are collected and raised in ConcurrencyError."""

    async def task(x: int) -> int:
        if x == 1:
            raise ValueError("error in task 1")
        if x == 3:
            raise RuntimeError("error in task 3")
        return x

    coroutines = [task(i) for i in range(5)]

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(coroutines, max_concurrency=3)

    # Should have 2 exceptions
    assert len(exc_info.value.exceptions) == 2
    assert isinstance(exc_info.value.exceptions[0], ValueError)
    assert isinstance(exc_info.value.exceptions[1], RuntimeError)
    assert "2 task(s) failed" in str(exc_info.value)


async def test_run_concurrently_empty_list():
    """Test running with empty coroutine list."""

    results = await run_concurrently([], max_concurrency=5)
    assert results == []


async def test_run_concurrently_single_task():
    """Test running with a single coroutine."""

    async def task() -> str:
        return "single"

    results = await run_concurrently([task()], max_concurrency=5)
    assert results == ["single"]


async def test_run_concurrently_timeout():
    """Test timeout cancels remaining tasks and returns partial results."""

    async def fast_task() -> str:
        await asyncio.sleep(0.01)
        return "fast"

    async def slow_task() -> str:
        await asyncio.sleep(1.0)  # Much longer than timeout
        return "slow"

    coroutines = [fast_task(), slow_task(), fast_task()]

    with pytest.raises(TimeoutError) as exc_info:
        await run_concurrently(coroutines, max_concurrency=3, timeout=0.1)

    # Should have partial_results attribute
    assert hasattr(exc_info.value, "partial_results")
    partial = exc_info.value.partial_results  # type: ignore[attr-defined]
    # At least the fast tasks should have completed
    assert "fast" in partial


async def test_run_concurrently_timeout_no_partial_results():
    """Test timeout with no completed tasks."""

    async def slow_task() -> str:
        await asyncio.sleep(1.0)
        return "slow"

    coroutines = [slow_task(), slow_task()]

    with pytest.raises(TimeoutError):
        await run_concurrently(coroutines, max_concurrency=3, timeout=0.05)


async def test_run_concurrently_max_concurrency_greater_than_tasks():
    """Test max_concurrency greater than number of tasks runs all at once."""

    active = 0
    max_active = 0

    async def task(x: int) -> int:
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.01)
        active -= 1
        return x

    coroutines = [task(i) for i in range(3)]
    results = await run_concurrently(coroutines, max_concurrency=10)  # > tasks

    assert results == [0, 1, 2]
    assert max_active == 3  # All ran concurrently


async def test_run_concurrently_mixed_success_failure():
    """Test mix of successful and failed tasks raises ConcurrencyError with all failures."""

    async def task(x: int) -> int:
        if x % 2 == 0:
            raise ValueError(f"even error {x}")
        await asyncio.sleep(0.01)
        return x

    coroutines = [task(i) for i in range(6)]

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently(coroutines, max_concurrency=4)

    # Tasks 0, 2, 4 failed - that's 3 exceptions
    assert len(exc_info.value.exceptions) == 3


async def test_concurrency_error_attributes():
    """Test ConcurrencyError has proper attributes."""

    async def failing_task() -> int:
        raise ValueError("boom")

    with pytest.raises(ConcurrencyError) as exc_info:
        await run_concurrently([failing_task(), failing_task()])

    assert len(exc_info.value.exceptions) == 2
    assert all(isinstance(e, ValueError) for e in exc_info.value.exceptions)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])