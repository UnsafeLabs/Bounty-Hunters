import asyncio
import warnings

import pytest
from fastapi.concurrency import ConcurrencyError, run_concurrently


def test_run_concurrently_limits_concurrency_and_preserves_order() -> None:
    async def run() -> None:
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
                worker(1, 0.03),
                worker(2, 0.01),
                worker(3, 0),
            ],
            max_concurrency=2,
        )

        assert results == [1, 2, 3]
        assert max_seen == 2

    asyncio.run(run())


def test_run_concurrently_max_concurrency_one_is_sequential() -> None:
    async def run() -> None:
        order: list[str] = []

        async def worker(value: str) -> str:
            order.append(f"start:{value}")
            await asyncio.sleep(0)
            order.append(f"end:{value}")
            return value

        results = await run_concurrently(
            [worker("a"), worker("b")],
            max_concurrency=1,
        )

        assert results == ["a", "b"]
        assert order == ["start:a", "end:a", "start:b", "end:b"]

    asyncio.run(run())


def test_run_concurrently_collects_exceptions_in_input_order() -> None:
    class FirstError(Exception):
        pass

    class SecondError(Exception):
        pass

    async def fail_late(exc: Exception, delay: float) -> None:
        await asyncio.sleep(delay)
        raise exc

    async def run() -> None:
        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(
                [
                    fail_late(FirstError(), 0.02),
                    fail_late(SecondError(), 0),
                ],
                max_concurrency=2,
            )

        failures = exc_info.value.failures
        assert [type(failure) for failure in failures] == [FirstError, SecondError]
        assert exc_info.value.exceptions == failures
        assert exc_info.value.errors == failures

    asyncio.run(run())


def test_run_concurrently_timeout_cancels_pending_and_keeps_partial_results() -> None:
    cancelled = False

    async def worker(value: int, delay: float) -> int:
        nonlocal cancelled
        try:
            await asyncio.sleep(delay)
            return value
        except asyncio.CancelledError:
            cancelled = True
            raise

    async def run() -> None:
        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(
                [worker(1, 0), worker(2, 1)],
                max_concurrency=2,
                timeout=0.05,
            )

        assert exc_info.value.partial_results == [1, None]
        assert exc_info.value.completed_indexes == {0}
        assert any(
            isinstance(failure, asyncio.TimeoutError)
            for failure in exc_info.value.failures
        )
        assert cancelled is True

    asyncio.run(run())


def test_run_concurrently_closes_unstarted_coroutines_on_timeout() -> None:
    async def worker() -> int:
        await asyncio.sleep(1)
        return 1

    async def run() -> None:
        coroutines = [worker(), worker()]
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            with pytest.raises(ConcurrencyError):
                await run_concurrently(
                    coroutines,
                    max_concurrency=1,
                    timeout=0.01,
                )

        assert not [
            warning
            for warning in caught
            if "was never awaited" in str(warning.message)
        ]

    asyncio.run(run())


def test_run_concurrently_allows_concurrency_above_task_count() -> None:
    async def run() -> None:
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
            max_concurrency=10,
        )

        assert results == [1, 2, 3]
        assert max_seen == 3

    asyncio.run(run())


def test_run_concurrently_returns_empty_list_for_no_tasks() -> None:
    async def run() -> None:
        assert await run_concurrently([], max_concurrency=3) == []

    asyncio.run(run())


def test_run_concurrently_rejects_invalid_concurrency_without_warnings() -> None:
    async def worker() -> None:
        await asyncio.sleep(0)

    async def run() -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            with pytest.raises(ValueError, match="max_concurrency"):
                await run_concurrently([worker()], max_concurrency=0)

        assert not [
            warning
            for warning in caught
            if "was never awaited" in str(warning.message)
        ]

    asyncio.run(run())
