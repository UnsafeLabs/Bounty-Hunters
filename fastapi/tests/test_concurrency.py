import asyncio

import pytest
from fastapi.concurrency import ConcurrencyError, run_concurrently


def test_run_concurrently_preserves_order_and_limits_concurrency():
    async def run_test():
        active = 0
        max_seen = 0

        async def worker(value: int, delay: float) -> int:
            nonlocal active, max_seen
            active += 1
            max_seen = max(max_seen, active)
            await asyncio.sleep(delay)
            active -= 1
            return value

        results = await run_concurrently(
            [
                worker(0, 0.03),
                worker(1, 0.01),
                worker(2, 0.02),
                worker(3, 0.01),
            ],
            max_concurrency=2,
        )
        return results, max_seen

    results, max_seen = asyncio.run(run_test())
    assert results == [0, 1, 2, 3]
    assert max_seen == 2


def test_run_concurrently_with_one_runs_sequentially():
    async def run_test():
        active = 0
        max_seen = 0

        async def worker(value: int) -> int:
            nonlocal active, max_seen
            active += 1
            max_seen = max(max_seen, active)
            await asyncio.sleep(0)
            active -= 1
            return value

        results = await run_concurrently(
            [worker(1), worker(2), worker(3)],
            max_concurrency=1,
        )
        return results, max_seen

    results, max_seen = asyncio.run(run_test())
    assert results == [1, 2, 3]
    assert max_seen == 1


def test_run_concurrently_allows_concurrency_above_task_count():
    async def run_test():
        active = 0
        max_seen = 0

        async def worker(value: int) -> int:
            nonlocal active, max_seen
            active += 1
            max_seen = max(max_seen, active)
            await asyncio.sleep(0.01)
            active -= 1
            return value

        results = await run_concurrently(
            [worker(1), worker(2), worker(3)],
            max_concurrency=10,
        )
        return results, max_seen

    results, max_seen = asyncio.run(run_test())
    assert results == [1, 2, 3]
    assert max_seen == 3


def test_run_concurrently_collects_all_failures():
    async def run_test():
        async def failing(message: str):
            await asyncio.sleep(0)
            raise RuntimeError(message)

        async def passing():
            await asyncio.sleep(0)
            return "ok"

        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(
                [failing("first"), passing(), failing("second")],
                max_concurrency=3,
            )
        return exc_info.value

    error = asyncio.run(run_test())
    assert [str(failure) for failure in error.failures] == ["first", "second"]
    assert error.partial_results == [None, "ok", None]


def test_run_concurrently_timeout_cancels_remaining_tasks():
    async def run_test():
        cancelled: list[bool] = []

        async def fast():
            return "done"

        async def slow():
            try:
                await asyncio.sleep(1)
            except asyncio.CancelledError:
                cancelled.append(True)
                raise

        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(
                [fast(), slow()],
                max_concurrency=2,
                timeout=0.01,
            )
        return exc_info.value, cancelled

    error, cancelled = asyncio.run(run_test())
    assert any(isinstance(failure, TimeoutError) for failure in error.failures)
    assert error.partial_results == ["done", None]
    assert cancelled == [True]


def test_run_concurrently_validates_max_concurrency():
    async def run_test():
        with pytest.raises(ValueError, match="max_concurrency"):
            await run_concurrently([], max_concurrency=0)

    asyncio.run(run_test())
