import asyncio

import pytest
from fastapi.concurrency import ConcurrencyError, run_concurrently


def test_run_concurrently_limits_concurrency_and_preserves_order() -> None:
    async def run() -> None:
        active = 0
        max_seen = 0

        async def worker(value: int) -> int:
            nonlocal active, max_seen
            active += 1
            max_seen = max(max_seen, active)
            await asyncio.sleep(0.01 * (4 - value))
            active -= 1
            return value

        results = await run_concurrently(
            [worker(1), worker(2), worker(3)],
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


def test_run_concurrently_collects_all_task_exceptions() -> None:
    class FirstError(Exception):
        pass

    class SecondError(Exception):
        pass

    async def fail(exc: Exception) -> None:
        await asyncio.sleep(0)
        raise exc

    async def run() -> None:
        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(
                [fail(FirstError()), fail(SecondError())],
                max_concurrency=2,
            )

        failures = exc_info.value.failures
        assert {type(failure) for failure in failures} == {FirstError, SecondError}

    asyncio.run(run())


def test_run_concurrently_timeout_cancels_pending_and_keeps_partial_results() -> None:
    async def worker(value: int, delay: float) -> int:
        await asyncio.sleep(delay)
        return value

    async def run() -> None:
        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(
                [worker(1, 0), worker(2, 1)],
                max_concurrency=2,
                timeout=0.05,
            )

        assert exc_info.value.partial_results[0] == 1
        assert exc_info.value.partial_results[1] is None
        assert any(
            isinstance(failure, asyncio.TimeoutError)
            for failure in exc_info.value.failures
        )

    asyncio.run(run())


def test_run_concurrently_allows_concurrency_above_task_count() -> None:
    async def worker(value: int) -> int:
        return value

    async def run() -> None:
        results = await run_concurrently(
            [worker(1), worker(2)],
            max_concurrency=10,
        )

        assert results == [1, 2]

    asyncio.run(run())


def test_run_concurrently_rejects_invalid_concurrency() -> None:
    async def run() -> None:
        with pytest.raises(ValueError, match="max_concurrency"):
            await run_concurrently([], max_concurrency=0)

    asyncio.run(run())
