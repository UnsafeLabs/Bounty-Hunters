import asyncio

import pytest
from fastapi.concurrency import ConcurrencyError, run_concurrently


def test_run_concurrently_limits_concurrency_and_preserves_input_order() -> None:
    async def scenario() -> tuple[list[int], int]:
        active = 0
        peak = 0

        async def worker(index: int, delay: float) -> int:
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            try:
                await asyncio.sleep(delay)
                return index
            finally:
                active -= 1

        results = await run_concurrently(
            [
                worker(0, 0.04),
                worker(1, 0.01),
                worker(2, 0.03),
                worker(3, 0.01),
            ],
            max_concurrency=2,
        )
        return results, peak

    results, peak = asyncio.run(scenario())

    assert results == [0, 1, 2, 3]
    assert peak == 2


def test_run_concurrently_with_one_worker_runs_sequentially() -> None:
    async def scenario() -> tuple[list[int], list[str]]:
        events: list[str] = []

        async def worker(index: int) -> int:
            events.append(f"start-{index}")
            await asyncio.sleep(0)
            events.append(f"finish-{index}")
            return index

        results = await run_concurrently(
            [worker(0), worker(1), worker(2)],
            max_concurrency=1,
        )
        return results, events

    results, events = asyncio.run(scenario())

    assert results == [0, 1, 2]
    assert events == [
        "start-0",
        "finish-0",
        "start-1",
        "finish-1",
        "start-2",
        "finish-2",
    ]


def test_run_concurrently_with_limit_above_task_count_runs_all_at_once() -> None:
    async def scenario() -> tuple[list[int], int]:
        active = 0
        peak = 0
        all_started = asyncio.Event()

        async def worker(index: int) -> int:
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            if active == 3:
                all_started.set()
            try:
                await all_started.wait()
                return index
            finally:
                active -= 1

        results = await run_concurrently(
            [worker(0), worker(1), worker(2)],
            max_concurrency=10,
            timeout=1,
        )
        return results, peak

    results, peak = asyncio.run(scenario())

    assert results == [0, 1, 2]
    assert peak == 3


def test_run_concurrently_collects_all_task_exceptions() -> None:
    async def scenario() -> None:
        async def ok() -> str:
            await asyncio.sleep(0)
            return "ok"

        async def fail(message: str) -> str:
            await asyncio.sleep(0)
            raise RuntimeError(message)

        await run_concurrently(
            [fail("first"), ok(), fail("second")],
            max_concurrency=3,
        )

    with pytest.raises(ConcurrencyError) as exc_info:
        asyncio.run(scenario())

    assert [str(error) for error in exc_info.value.exceptions] == ["first", "second"]
    assert exc_info.value.partial_results == [None, "ok", None]


def test_run_concurrently_timeout_cancels_pending_tasks() -> None:
    async def scenario() -> tuple[ConcurrencyError, bool]:
        slow_cancelled = False

        async def quick() -> str:
            await asyncio.sleep(0.01)
            return "done"

        async def slow() -> str:
            nonlocal slow_cancelled
            try:
                await asyncio.sleep(5)
            except asyncio.CancelledError:
                slow_cancelled = True
                raise
            return "late"

        try:
            await run_concurrently(
                [quick(), slow()],
                max_concurrency=2,
                timeout=0.05,
            )
        except ConcurrencyError as exc:
            return exc, slow_cancelled

        raise AssertionError("run_concurrently should time out")

    error, slow_cancelled = asyncio.run(scenario())

    assert any(isinstance(exc, TimeoutError) for exc in error.exceptions)
    assert error.partial_results == ["done", None]
    assert slow_cancelled is True


def test_run_concurrently_rejects_invalid_concurrency_limit() -> None:
    async def worker() -> None:
        return None

    with pytest.raises(ValueError, match="max_concurrency must be at least 1"):
        asyncio.run(run_concurrently([worker()], max_concurrency=0))
