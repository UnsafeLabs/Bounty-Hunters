"""Tests for BackgroundTasks v2"""
import pytest, asyncio
from background_tasks import BackgroundTasks
class TestBGV2:
    @pytest.mark.asyncio
    async def test_success(self):
        bt = BackgroundTasks()
        async def ok(): return 1
        bt.add_task(ok); r = await bt.run_all(); assert r[0].success
    @pytest.mark.asyncio
    async def test_retry_backoff(self):
        cnt = [0]
        async def flaky():
            cnt[0] += 1
            if cnt[0] < 3: raise ValueError()
            return "ok"
        bt = BackgroundTasks(max_retries=3, base_delay=0.01)
        bt.add_task(flaky); r = await bt.run_all()
        assert r[0].success; assert cnt[0] == 3
    @pytest.mark.asyncio
    async def test_exhausted(self):
        async def fail(): raise RuntimeError()
        bt = BackgroundTasks(max_retries=1, base_delay=0.01)
        bt.add_task(fail); r = await bt.run_all(); assert not r[0].success
    @pytest.mark.asyncio
    async def test_error_callback(self):
        errs = []
        async def fail(): raise ValueError("x")
        bt = BackgroundTasks(max_retries=0, error_callback=lambda r: errs.append(r))
        bt.add_task(fail); await bt.run_all(); assert len(errs) == 1
