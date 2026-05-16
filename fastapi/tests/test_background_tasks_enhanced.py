"""Tests for BackgroundTasks error handling, retry, and result tracking."""

from fastapi import BackgroundTasks


class TestErrorHandling:
    """Background task exceptions are caught and logged instead of silently failing."""

    def test_error_is_caught(self):
        """A task that raises should not propagate the exception."""

        def failing_task():
            raise ValueError("something went wrong")

        bt = BackgroundTasks()
        bt.add_task(failing_task)
        # Should not raise
        import asyncio
        asyncio.run(bt())

    def test_error_callback_is_invoked(self):
        """Error callback is invoked with the exception object and original task function name."""

        captured = []

        def on_error(exc: Exception, name: str):
            captured.append((exc, name))

        def failing_task():
            raise ValueError("boom")

        bt = BackgroundTasks(error_callback=on_error)
        bt.add_task(failing_task)
        import asyncio
        asyncio.run(bt())

        assert len(captured) == 1
        exc, name = captured[0]
        assert isinstance(exc, ValueError)
        assert str(exc) == "boom"
        assert name == "failing_task"

    def test_per_task_error_callback_overrides_global(self):
        """A per-task error_callback should override the global one."""

        global_captured = []
        task_captured = []

        def global_cb(exc, name):
            global_captured.append((exc, name))

        def task_cb(exc, name):
            task_captured.append((exc, name))

        def failing_task():
            raise RuntimeError("fail")

        bt = BackgroundTasks(error_callback=global_cb)
        bt.add_task(failing_task, error_callback=task_cb)
        import asyncio
        asyncio.run(bt())

        assert len(global_captured) == 0, "Global callback should not fire"
        assert len(task_captured) == 1, "Task callback should fire"
        assert isinstance(task_captured[0][0], RuntimeError)

    def test_async_task_error_callback(self):
        """Error callback works for async tasks too."""

        captured = []

        def on_error(exc: Exception, name: str):
            captured.append((exc, name))

        async def failing_async():
            raise ValueError("async error")

        bt = BackgroundTasks(error_callback=on_error)
        bt.add_task(failing_async)
        import asyncio
        asyncio.run(bt())

        assert len(captured) == 1
        assert "failing_async" in captured[0][1]


class TestRetryMechanism:
    """Retry mechanism re-executes failed tasks up to max_retries times."""

    def test_no_retry_by_default(self):
        """With max_retries=0, the task runs exactly once even on failure."""

        call_count = 0

        def failing_task():
            nonlocal call_count
            call_count += 1
            raise ValueError("fail")

        bt = BackgroundTasks()
        bt.add_task(failing_task, max_retries=0)
        import asyncio
        asyncio.run(bt())

        assert call_count == 1

    def test_retries_on_failure(self):
        """Task is retried max_retries times when it keeps failing."""

        call_count = 0

        def always_fails():
            nonlocal call_count
            call_count += 1
            raise ValueError("still failing")

        bt = BackgroundTasks()
        bt.add_task(always_fails, max_retries=3)
        import asyncio
        asyncio.run(bt())

        # 1 initial attempt + 3 retries = 4 total
        assert call_count == 4

    def test_retry_stops_on_success(self):
        """If a retry succeeds, remaining retries are skipped."""

        call_count = 0

        def eventually_succeeds():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise ValueError("not yet")
            # 3rd attempt succeeds

        bt = BackgroundTasks()
        bt.add_task(eventually_succeeds, max_retries=5)
        import asyncio
        asyncio.run(bt())

        assert call_count == 3, f"Expected 3 calls, got {call_count}"

    def test_async_retry(self):
        """Retry works for async tasks."""

        call_count = 0

        async def failing_async():
            nonlocal call_count
            call_count += 1
            raise RuntimeError("async fail")

        bt = BackgroundTasks()
        bt.add_task(failing_async, max_retries=2)
        import asyncio
        asyncio.run(bt())

        assert call_count == 3  # 1 initial + 2 retries


class TestTaskResults:
    """task_results stores status, exception message, and retry count."""

    def test_successful_task_result(self):
        """A successful task should have status='success'."""

        def good_task():
            return 42

        bt = BackgroundTasks()
        bt.add_task(good_task)
        import asyncio
        asyncio.run(bt())

        assert len(bt.task_results) == 1
        assert bt.task_results[0].status == "success"
        assert bt.task_results[0].exception is None

    def test_failed_task_result(self):
        """A failed task should have status='failed', exception, and retry_count."""

        def bad_task():
            raise ValueError("broken")

        bt = BackgroundTasks()
        bt.add_task(bad_task, max_retries=2)
        import asyncio
        asyncio.run(bt())

        assert len(bt.task_results) == 1
        result = bt.task_results[0]
        assert result.status == "failed"
        assert "broken" in (result.exception or "")
        assert result.retry_count == 2  # 2 retries after initial attempt

    def test_multiple_tasks_results(self):
        """Multiple tasks each have their own result."""

        def task_a():
            raise ValueError("a fails")

        def task_b():
            pass  # succeeds

        bt = BackgroundTasks()
        bt.add_task(task_a, max_retries=1)
        bt.add_task(task_b)
        import asyncio
        asyncio.run(bt())

        assert len(bt.task_results) == 2
        assert bt.task_results[0].func_name == "task_a"
        assert bt.task_results[0].status == "failed"
        assert bt.task_results[1].func_name == "task_b"
        assert bt.task_results[1].status == "success"


class TestExistingBehavior:
    """Existing background task behavior without error callback or retries works exactly as before."""

    def test_successful_task_no_callbacks(self):
        """A working task with no error_callback and no retries should run normally."""

        results = []

        def my_task(val: str):
            results.append(val)

        bt = BackgroundTasks()
        bt.add_task(my_task, "hello")
        import asyncio
        asyncio.run(bt())

        assert results == ["hello"]

    def test_backwards_compatible_add_task(self):
        """Calling add_task without error_callback or max_retries should work like before."""

        bt = BackgroundTasks()
        # Just like the old add_task(func, *args, **kwargs)
        bt.add_task(lambda: None)
        import asyncio
        asyncio.run(bt())

        assert len(bt.task_results) == 1