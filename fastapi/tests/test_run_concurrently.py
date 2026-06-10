"""Tests for run_concurrently and ConcurrencyError."""

import asyncio

import pytest

from fastapi.concurrency import ConcurrencyError, run_concurrently


async def _success(value: int, delay: float = 0.01) -> int:
    await asyncio.sleep(delay)
    return value


async def _fail(msg: str, delay: float = 0.01) -> None:
    await asyncio.sleep(delay)
    raise RuntimeError(msg)


class TestRunConcurrently:
    @pytest.mark.anyio
    async def test_basic_execution(self):
        coros = [_success(i) for i in range(5)]
        results = await run_concurrently(coros)
        assert results == [0, 1, 2, 3, 4]

    @pytest.mark.anyio
    async def test_order_preserved(self):
        """Tasks with varying delays still return in input order."""

        async def delayed(idx: int, delay: float) -> int:
            await asyncio.sleep(delay)
            return idx

        coros = [delayed(0, 0.05), delayed(1, 0.01), delayed(2, 0.03)]
        results = await run_concurrently(coros)
        assert results == [0, 1, 2]

    @pytest.mark.anyio
    async def test_max_concurrency_sequential(self):
        """max_concurrency=1 executes tasks sequentially."""
        execution_order: list[int] = []

        async def track(idx: int) -> int:
            execution_order.append(idx)
            await asyncio.sleep(0.01)
            return idx

        coros = [track(i) for i in range(3)]
        results = await run_concurrently(coros, max_concurrency=1)
        assert results == [0, 1, 2]
        assert execution_order == [0, 1, 2]

    @pytest.mark.anyio
    async def test_max_concurrency_greater_than_tasks(self):
        """max_concurrency > task count runs all at once."""
        coros = [_success(i, delay=0.01) for i in range(2)]
        results = await run_concurrently(coros, max_concurrency=100)
        assert results == [0, 1]

    @pytest.mark.anyio
    async def test_error_raises_concurrency_error(self):
        coros = [_success(1), _fail("boom"), _success(3)]
        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(coros)
        assert len(exc_info.value.errors) == 1
        assert isinstance(exc_info.value.errors[0], RuntimeError)
        assert "boom" in str(exc_info.value.errors[0])

    @pytest.mark.anyio
    async def test_multiple_errors(self):
        coros = [_fail("err1"), _success(1), _fail("err2")]
        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(coros)
        assert len(exc_info.value.errors) == 2

    @pytest.mark.anyio
    async def test_partial_results_in_error(self):
        coros = [_success(42), _fail("err"), _success(99)]
        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(coros)
        assert exc_info.value.partial_results[0] == 42
        assert exc_info.value.partial_results[2] == 99

    @pytest.mark.anyio
    async def test_timeout_cancels_remaining(self):
        async def slow() -> int:
            await asyncio.sleep(10)
            return 1

        coros = [_success(1, delay=0.01), slow(), _success(3, delay=0.01)]
        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(coros, timeout=0.5)
        assert any(isinstance(e, TimeoutError) for e in exc_info.value.errors)

    @pytest.mark.anyio
    async def test_empty_coroutines(self):
        results = await run_concurrently([])
        assert results == []

    @pytest.mark.anyio
    async def test_concurrency_limit_respected(self):
        """Verify that at most max_concurrency tasks run simultaneously."""
        import time

        peak = 0
        current = 0

        async def tracked() -> int:
            nonlocal peak, current
            current += 1
            peak = max(peak, current)
            await asyncio.sleep(0.05)
            current -= 1
            return 0

        coros = [tracked() for _ in range(6)]
        await run_concurrently(coros, max_concurrency=2)
        assert peak <= 2


class TestConcurrencyError:
    def test_attributes(self):
        errs = [RuntimeError("a"), ValueError("b")]
        results = [1, None, 3]
        exc = ConcurrencyError(errs, results)
        assert exc.errors == errs
        assert exc.partial_results == results
        assert "2 task(s) failed" in str(exc)
