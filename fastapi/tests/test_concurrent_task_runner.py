from __future__ import annotations

import asyncio

import pytest

from fastapi.concurrency import ConcurrencyError, run_concurrently


# ---------------------------------------------------------------------------
# Tests — basic execution
# ---------------------------------------------------------------------------


class TestRunConcurrently:
    @pytest.mark.anyio
    async def test_empty_input(self):
        result = await run_concurrently()
        assert result == []

    @pytest.mark.anyio
    async def test_single_task(self):
        async def work():
            return 42

        result = await run_concurrently(work())
        assert result == [42]

    @pytest.mark.anyio
    async def test_multiple_tasks(self):
        async def work(n):
            return n * 2

        result = await run_concurrently(work(1), work(2), work(3))
        assert result == [2, 4, 6]

    @pytest.mark.anyio
    async def test_results_maintain_order(self):
        """Results should be in input order, not completion order."""
        async def slow():
            await asyncio.sleep(0.3)
            return "slow"

        async def fast():
            await asyncio.sleep(0.1)
            return "fast"

        result = await run_concurrently(slow(), fast())
        assert result == ["slow", "fast"]

    @pytest.mark.anyio
    async def test_concurrency_limit_respected(self):
        """With max_concurrency=1, tasks run sequentially."""
        running = 0
        max_running = 0

        async def work():
            nonlocal running, max_running
            running += 1
            max_running = max(max_running, running)
            await asyncio.sleep(0.1)
            running -= 1

        await run_concurrently(
            work(), work(), work(), work(),
            max_concurrency=1,
        )
        assert max_running == 1

    @pytest.mark.anyio
    async def test_concurrency_limit_allows_parallel(self):
        """With higher limit, tasks can run in parallel."""
        running = 0
        max_running = 0

        async def work():
            nonlocal running, max_running
            running += 1
            max_running = max(max_running, running)
            await asyncio.sleep(0.2)
            running -= 1

        await run_concurrently(
            work(), work(), work(), work(),
            max_concurrency=4,
        )
        assert max_running > 1

    @pytest.mark.anyio
    async def test_max_concurrency_one_sequential(self):
        """max_concurrency=1 should execute tasks one at a time."""
        order = []

        async def work(n):
            order.append(f"start-{n}")
            await asyncio.sleep(0.05)
            order.append(f"end-{n}")

        await run_concurrently(work(1), work(2), work(3), max_concurrency=1)
        # With concurrency=1, each task starts after the previous ends.
        assert order == ["start-1", "end-1", "start-2", "end-2", "start-3", "end-3"]

    @pytest.mark.anyio
    async def test_max_concurrency_greater_than_tasks(self):
        """max_concurrency > task count should run all at once."""
        running = 0
        max_running = 0

        async def work():
            nonlocal running, max_running
            running += 1
            max_running = max(max_running, running)
            await asyncio.sleep(0.1)
            running -= 1

        await run_concurrently(work(), work(), max_concurrency=100)
        assert max_running == 2


# ---------------------------------------------------------------------------
# Tests — error handling
# ---------------------------------------------------------------------------


class TestErrorHandling:
    @pytest.mark.anyio
    async def test_single_failure(self):
        async def ok():
            return "ok"

        async def fail():
            raise ValueError("boom")

        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(ok(), fail())

        assert len(exc_info.value.exceptions) == 1
        idx, exc = exc_info.value.exceptions[0]
        assert idx == 1
        assert isinstance(exc, ValueError)

    @pytest.mark.anyio
    async def test_multiple_failures(self):
        async def fail1():
            raise TypeError("err1")

        async def fail2():
            raise RuntimeError("err2")

        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(fail1(), fail2())

        assert len(exc_info.value.exceptions) == 2

    @pytest.mark.anyio
    async def test_mixed_success_and_failure(self):
        async def ok():
            return "ok"

        async def fail():
            raise ValueError("boom")

        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(ok(), fail(), ok())

        assert len(exc_info.value.exceptions) == 1
        assert exc_info.value.exceptions[0][0] == 1


# ---------------------------------------------------------------------------
# Tests — timeout
# ---------------------------------------------------------------------------


class TestTimeout:
    @pytest.mark.anyio
    async def test_timeout_raises_on_all_timeout(self):
        async def slow():
            await asyncio.sleep(10)
            return "done"

        with pytest.raises(ConcurrencyError):
            await run_concurrently(slow(), slow(), timeout=0.1)

    @pytest.mark.anyio
    async def test_timeout_partial_results(self):
        async def fast():
            return "fast"

        async def slow():
            await asyncio.sleep(10)
            return "slow"

        # The fast task should complete, the slow one should timeout.
        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(fast(), slow(), timeout=0.5)

        # At least one failure (the timeout)
        assert len(exc_info.value.exceptions) >= 1

    @pytest.mark.anyio
    async def test_no_timeout_when_all_complete(self):
        async def work():
            await asyncio.sleep(0.05)
            return "done"

        result = await run_concurrently(work(), work(), timeout=5.0)
        assert result == ["done", "done"]
