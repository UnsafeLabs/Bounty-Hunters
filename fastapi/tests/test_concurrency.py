
import asyncio
import pytest
from fastapi.fastapi.concurrency import run_concurrently, ConcurrencyError


class TestRunConcurrently:
    async def test_empty_coroutines(self):
        result = await run_concurrently()
        assert result == []

    async def test_single_coroutine(self):
        async def f():
            return 42
        result = await run_concurrently(f())
        assert result == [42]

    async def test_multiple_coroutines_results_order(self):
        async def f(val, delay):
            await asyncio.sleep(delay)
            return val
        result = await run_concurrently(
            f(1, 0.03), f(2, 0.01), f(3, 0.02)
        )
        assert result == [1, 2, 3]

    async def test_max_concurrency_limits_execution(self):
        running = 0
        max_seen = 0

        async def f():
            nonlocal running, max_seen
            running += 1
            max_seen = max(max_seen, running)
            await asyncio.sleep(0.01)
            running -= 1
            return 1

        await run_concurrently(*[f() for _ in range(10)], max_concurrency=3)
        assert max_seen <= 3

    async def test_max_concurrency_1_sequential(self):
        running = 0
        max_seen = 0

        async def f():
            nonlocal running, max_seen
            running += 1
            max_seen = max(max_seen, running)
            await asyncio.sleep(0.01)
            running -= 1
            return 1

        await run_concurrently(*[f() for _ in range(5)], max_concurrency=1)
        assert max_seen == 1

    async def test_max_concurrency_exceeds_task_count(self):
        result = await run_concurrently(
            *[asyncio.sleep(0)] * 3, max_concurrency=10
        )
        assert result == [None, None, None]

    async def test_error_collects_all_failures(self):
        async def fail(msg):
            raise ValueError(msg)

        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(
                fail('err1'), fail('err2'), fail('err3')
            )
        assert len(exc_info.value.errors) == 3
        assert all(isinstance(e, ValueError) for e in exc_info.value.errors)

    async def test_error_with_partial_results(self):
        async def ok(val):
            return val

        async def fail():
            raise RuntimeError('boom')

        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(ok(1), fail(), ok(3), fail())
        err = exc_info.value
        assert len(err.errors) == 2
        assert err.results[0] == 1
        assert err.results[2] == 3

    async def test_timeout_cancels_remaining(self):
        async def slow():
            await asyncio.sleep(10)
            return 'never'

        async def fast():
            await asyncio.sleep(0.01)
            return 'done'

        with pytest.raises(ConcurrencyError) as exc_info:
            await run_concurrently(fast(), slow(), timeout=0.05)
        err = exc_info.value
        assert err.results[0] == 'done'
        assert any(isinstance(e, TimeoutError) for e in err.errors)
