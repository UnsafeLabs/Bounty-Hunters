from fastapi import BackgroundTasks


def test_background_task_success_records_result():
    tasks = BackgroundTasks()
    values = []

    def task(value: str) -> None:
        values.append(value)

    tasks.add_task(task, "ok")

    import anyio

    anyio.run(tasks)

    assert values == ["ok"]
    assert tasks.task_results == [
        {
            "status": "success",
            "task_name": "task",
            "exception": None,
            "retry_count": 0,
        }
    ]


def test_background_task_failure_is_recorded_without_raising():
    tasks = BackgroundTasks()
    callback_calls = []

    def task() -> None:
        raise RuntimeError("boom")

    def on_error(exc: Exception, task_name: str) -> None:
        callback_calls.append((str(exc), task_name))

    tasks.add_task(task, on_error=on_error)

    import anyio

    anyio.run(tasks)

    assert callback_calls == [("boom", "task")]
    assert tasks.task_results == [
        {
            "status": "failed",
            "task_name": "task",
            "exception": "boom",
            "retry_count": 0,
        }
    ]


def test_background_task_retries_until_success():
    tasks = BackgroundTasks()
    attempts = []

    def task() -> None:
        attempts.append("attempt")
        if len(attempts) < 3:
            raise RuntimeError("retry me")

    tasks.add_task(task, max_retries=2)

    import anyio

    anyio.run(tasks)

    assert len(attempts) == 3
    assert tasks.task_results == [
        {
            "status": "success",
            "task_name": "task",
            "exception": None,
            "retry_count": 2,
        }
    ]


def test_background_task_retry_exhaustion_records_final_failure():
    tasks = BackgroundTasks()
    attempts = []

    def task() -> None:
        attempts.append("attempt")
        raise RuntimeError("still broken")

    tasks.add_task(task, max_retries=2)

    import anyio

    anyio.run(tasks)

    assert len(attempts) == 3
    assert tasks.task_results == [
        {
            "status": "failed",
            "task_name": "task",
            "exception": "still broken",
            "retry_count": 2,
        }
    ]
