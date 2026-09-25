import asyncio
import contextvars
import inspect
import json
import logging
import math
import time
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable, Coroutine, Iterable
from contextlib import suppress
from importlib import import_module
from typing import Any, cast

import anyio
import starlette.websockets
from starlette.responses import Response
from starlette.types import Message
from starlette.websockets import WebSocket as WebSocket  # noqa
from starlette.websockets import WebSocketDisconnect as WebSocketDisconnect  # noqa
from starlette.websockets import WebSocketState as WebSocketState  # noqa

DisconnectCallback = Callable[[int, float], Awaitable[Any] | Any]
logger = logging.getLogger("fastapi.websockets")
_MAX_PENDING_MESSAGES = 32
_disconnect_callback_context: contextvars.ContextVar[Any | None] = (
    contextvars.ContextVar("fastapi_websocket_disconnect_callback", default=None)
)


class _BackgroundTask:
    def __init__(self, coroutine: Callable[[], Coroutine[Any, Any, None]]) -> None:
        self._coroutine = coroutine
        self._cancel_scope: anyio.CancelScope | None = None
        self._cancel_requested = False
        self._done = anyio.Event()
        self._task_id: int | None = None
        self._asyncio_task: asyncio.Task[None] | None = None

    @property
    def done(self) -> bool:
        return self._done.is_set()

    @property
    def is_current(self) -> bool:
        return self._task_id == anyio.get_current_task().id

    def start(self) -> None:
        if _is_trio_backend():
            trio = cast(Any, import_module("trio"))
            context = contextvars.copy_context()
            spawn_system_task = trio.lowlevel.spawn_system_task
            if "context" in inspect.signature(spawn_system_task).parameters:
                spawn_system_task(self._run, context=context)
            else:
                # Trio added the context argument in 0.22. Older versions inherit
                # the context active when spawn_system_task is called.
                context.run(spawn_system_task, self._run)
        else:
            self._asyncio_task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self.done or self.is_current:
            return
        self._cancel_requested = True
        if self._cancel_scope is not None:
            self._cancel_scope.cancel()
        await self._done.wait()

    async def _run(self) -> None:
        self._task_id = anyio.get_current_task().id
        try:
            with anyio.CancelScope() as cancel_scope:
                self._cancel_scope = cancel_scope
                if self._cancel_requested:
                    cancel_scope.cancel()
                await self._coroutine()
        except BaseException as exc:
            if isinstance(
                exc, (KeyboardInterrupt, SystemExit, anyio.get_cancelled_exc_class())
            ):
                raise
            logger.exception("WebSocket background task failed")
        finally:
            self._done.set()


class WebSocketWithHeartbeat:
    """Add an application heartbeat and connection metrics to a WebSocket.

    RFC 6455 PING/PONG control frames are intentionally handled by the ASGI
    protocol server and are not exposed as application events by core ASGI.
    Configure the server's WebSocket ping interval/timeout when protocol-level
    heartbeats are required. This wrapper provides an application-level
    binary heartbeat for per-connection liveness plus disconnect metrics.
    """

    def __init__(
        self,
        websocket: WebSocket,
        *,
        ping_interval: float = 30.0,
        pong_timeout: float = 10.0,
        on_disconnect: DisconnectCallback | None = None,
        ping_message: bytes = b"ping",
        pong_message: bytes = b"pong",
    ) -> None:
        if not math.isfinite(ping_interval) or ping_interval <= 0:
            raise ValueError("ping_interval must be greater than 0")
        if not math.isfinite(pong_timeout) or pong_timeout <= 0:
            raise ValueError("pong_timeout must be greater than 0")

        self.websocket = websocket
        self.ping_interval = ping_interval
        self.pong_timeout = pong_timeout
        self.on_disconnect = on_disconnect
        self.ping_message = ping_message
        self.pong_message = pong_message
        self._started_at: float | None = None
        self._ended_at: float | None = None
        self._message_count = 0
        self._pong_received: anyio.Event | None = None
        self._waiting_for_pong = False
        self._messages: deque[Message | Exception] = deque()
        self._pending_message_count = 0
        self._message_available: anyio.Event | None = None
        self._receive_task: _BackgroundTask | None = None
        self._heartbeat_task: _BackgroundTask | None = None
        self._heartbeat_restart_task: _BackgroundTask | None = None
        self._teardown_task: _BackgroundTask | None = None
        self._send_lock: anyio.Lock | None = None
        self._receive_lock: anyio.Lock | None = None
        self._transport_receive_lock: anyio.Lock | None = None
        self._closed = False
        self._close_code = 1000
        self._close_reason: str | None = None
        self._disconnect_delivered = False
        self._disconnect_notified = False
        self._disconnect_queued = False
        self._teardown_done: anyio.Event | None = None
        self._teardown_closes_socket = False
        self._teardown_error: Exception | None = None
        self._heartbeat_active = False
        self._active_send_scope: anyio.CancelScope | None = None
        self._active_receive_scopes: set[anyio.CancelScope] = set()

    def __getattr__(self, name: str) -> Any:
        return getattr(self.websocket, name)

    async def __aenter__(self) -> "WebSocketWithHeartbeat":
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.close()

    @property
    def connection_duration(self) -> float:
        started_at = self._started_at
        if started_at is None:
            return 0.0
        ended_at = self._ended_at
        if ended_at is None:
            ended_at = time.monotonic()
        return ended_at - started_at

    @property
    def message_count(self) -> int:
        """Return the number of application messages accepted for delivery.

        Heartbeat pong responses to our pings are excluded. Unsolicited pong
        messages are counted as application messages. Messages that arrived
        after the pending-message limit was reached are not counted, because
        they are never handed to the application.
        """
        return self._message_count

    async def accept(
        self,
        subprotocol: str | None = None,
        headers: Iterable[tuple[bytes, bytes]] | None = None,
    ) -> None:
        self._initialize_async_resources()
        assert self._send_lock is not None
        try:
            async with self._send_lock:
                if self._closed:
                    raise _websocket_disconnected(
                        'Cannot call "send" once a close message has been sent.'
                    )
                with anyio.CancelScope() as accept_scope:
                    self._active_send_scope = accept_scope
                    try:
                        await self.websocket.accept(
                            subprotocol=subprotocol, headers=headers
                        )
                    finally:
                        if self._active_send_scope is accept_scope:
                            self._active_send_scope = None
                if accept_scope.cancel_called:
                    raise _websocket_disconnected(
                        "WebSocket accept was interrupted by connection close."
                    )
        except WebSocketDisconnect as exc:
            await self._handle_disconnect(exc.code, exc.reason)
            raise
        except BaseException as exc:
            if isinstance(exc, anyio.get_cancelled_exc_class()):
                self._close_interrupted_accept()
            raise
        self._connection_accepted()

    def start_heartbeat(self) -> None:
        if self._closed:
            raise RuntimeError("Cannot start heartbeat on a closed WebSocket")
        self._ensure_connected()
        if self._started_at is None:
            self._started_at = time.monotonic()
        self._initialize_async_resources()
        self._heartbeat_active = True
        self._start_receiver()
        if self._heartbeat_task is None or self._heartbeat_task.done:
            self._heartbeat_task = _BackgroundTask(self._heartbeat_loop)
            self._heartbeat_task.start()

    async def stop_heartbeat(self) -> None:
        self._heartbeat_active = False
        task = self._heartbeat_task
        try:
            await self._stop_task(task)
        finally:
            # start_heartbeat() is synchronous and can run while stop() yields. If
            # it observed the old task before it finished, honor that restart even
            # when this stop caller is cancelled.
            if (
                self._heartbeat_active
                and not self._closed
                and self._heartbeat_task is task
            ):
                if task is not None and not task.done:
                    restart_task = self._heartbeat_restart_task
                    if restart_task is None or restart_task.done:
                        self._heartbeat_restart_task = _BackgroundTask(
                            lambda: self._restart_heartbeat_after(task)
                        )
                        self._heartbeat_restart_task.start()
                else:
                    self._heartbeat_task = _BackgroundTask(self._heartbeat_loop)
                    self._heartbeat_task.start()

    async def _restart_heartbeat_after(self, task: _BackgroundTask) -> None:
        await task.stop()
        if self._heartbeat_active and not self._closed and self._heartbeat_task is task:
            self._heartbeat_task = _BackgroundTask(self._heartbeat_loop)
            self._heartbeat_task.start()

    async def _stop_receiver(self) -> None:
        await self._stop_task(self._receive_task)

    async def _stop_background_tasks(self) -> None:
        await self.stop_heartbeat()
        await self._stop_task(self._heartbeat_restart_task)
        await self._stop_receiver()

    @staticmethod
    async def _stop_task(task: _BackgroundTask | None) -> None:
        if task is not None:
            await task.stop()

    async def close(self, code: int = 1000, reason: str | None = None) -> None:
        started_teardown = self._mark_closed(code, reason)
        if started_teardown:
            self._start_teardown(close_socket=True)
        elif (
            self._teardown_task is not None and self._teardown_task.is_current
        ) or self._called_from_disconnect_callback():
            return
        await self._wait_for_teardown()
        if self._teardown_error is not None:
            raise self._teardown_error

    async def receive(self) -> Message:
        self._raise_if_disconnect_delivered()
        self._initialize_async_resources()
        if (
            not self._closed
            and not self._messages
            and (self._receive_task is None or self._receive_task.done)
            and self.websocket.application_state != WebSocketState.CONNECTED
        ):
            return await self._receive_directly()
        if self._receive_task is None and not self._closed:
            if self.websocket.application_state != WebSocketState.CONNECTED:
                return await self.websocket.receive()
            self._start_receiver()
        while True:
            assert self._receive_lock is not None
            async with self._receive_lock:
                self._raise_if_disconnect_delivered()
                if self._messages:
                    item = self._messages.popleft()
                    if isinstance(item, Exception):
                        raise item
                    if item["type"] == "websocket.receive":
                        self._pending_message_count -= 1
                    if item["type"] == "websocket.disconnect":
                        self._disconnect_delivered = True
                    return item
                if (
                    self._closed
                    and self._disconnect_notified
                    and not self._disconnect_queued
                ):
                    # The disconnect was observed but the real queued message is
                    # not ready yet because on_disconnect is still running.
                    # Normal application receivers must wait for the callback
                    # to finish so callback ordering is preserved. Only the
                    # teardown task itself (e.g. on_disconnect calling
                    # receive()) gets a synthetic message to avoid deadlock.
                    teardown_task = self._teardown_task
                    is_teardown_caller = False
                    if teardown_task is not None:
                        with suppress(Exception):
                            is_teardown_caller = teardown_task.is_current
                    if is_teardown_caller or self._called_from_disconnect_callback():
                        self._disconnect_delivered = True
                        return cast(
                            Message,
                            {
                                "type": "websocket.disconnect",
                                "code": self._close_code,
                                "reason": self._close_reason,
                            },
                        )
                    assert self._teardown_done is not None
                    teardown_done = self._teardown_done
                    assert self._message_available is not None
                    if self._message_available.is_set():
                        self._message_available = anyio.Event()
                        continue
                    wait_event = self._message_available
                else:
                    assert self._message_available is not None
                    if self._message_available.is_set():
                        self._message_available = anyio.Event()
                        continue
                    wait_event = self._message_available
                    teardown_done = None
            if teardown_done is not None:
                await teardown_done.wait()
            else:
                await wait_event.wait()

    async def receive_text(self) -> str:
        self._ensure_connected()
        message = await self.receive()
        self._raise_on_disconnect(message)
        return cast(str, message["text"])

    async def receive_bytes(self) -> bytes:
        self._ensure_connected()
        message = await self.receive()
        self._raise_on_disconnect(message)
        return cast(bytes, message["bytes"])

    async def receive_json(self, mode: str = "text") -> Any:
        if mode not in {"text", "binary"}:
            raise RuntimeError('The "mode" argument should be "text" or "binary".')
        self._ensure_connected()
        message = await self.receive()
        self._raise_on_disconnect(message)
        if mode == "text":
            text = message["text"]
        else:
            text = message["bytes"].decode("utf-8")
        return json.loads(text)

    async def iter_text(self) -> AsyncIterator[str]:
        try:
            while True:
                yield await self.receive_text()
        except WebSocketDisconnect:
            pass

    async def iter_bytes(self) -> AsyncIterator[bytes]:
        try:
            while True:
                yield await self.receive_bytes()
        except WebSocketDisconnect:
            pass

    async def iter_json(self) -> AsyncIterator[Any]:
        try:
            while True:
                yield await self.receive_json()
        except WebSocketDisconnect:
            pass

    async def send(self, message: Message) -> None:
        if message["type"] == "websocket.close":
            await self.close(
                code=int(message.get("code", 1000)), reason=message.get("reason")
            )
            return
        if self._closed:
            raise _websocket_disconnected(
                'Cannot call "send" once a close message has been sent.'
            )
        self._initialize_async_resources()
        assert self._send_lock is not None
        try:
            async with self._send_lock:
                if self._closed:
                    raise _websocket_disconnected(
                        'Cannot call "send" once a close message has been sent.'
                    )
                with anyio.CancelScope() as send_scope:
                    self._active_send_scope = send_scope
                    try:
                        await self.websocket.send(message)
                    finally:
                        if self._active_send_scope is send_scope:
                            self._active_send_scope = None
                if send_scope.cancel_called:
                    raise _websocket_disconnected(
                        "WebSocket send was interrupted by connection close."
                    )
        except WebSocketDisconnect as exc:
            await self._handle_disconnect(exc.code, exc.reason)
            raise
        except BaseException as exc:
            if message["type"] == "websocket.accept" and isinstance(
                exc, anyio.get_cancelled_exc_class()
            ):
                self._close_interrupted_accept()
            raise
        if message["type"] == "websocket.accept":
            self._connection_accepted()
        elif message["type"] == "websocket.http.response.body" and not message.get(
            "more_body", False
        ):
            self._mark_denied()
            await self._stop_background_tasks()

    async def send_text(self, data: str) -> None:
        await self.send({"type": "websocket.send", "text": data})

    async def send_bytes(self, data: bytes) -> None:
        await self.send({"type": "websocket.send", "bytes": data})

    async def send_json(self, data: Any, mode: str = "text") -> None:
        if mode not in {"text", "binary"}:
            raise RuntimeError('The "mode" argument should be "text" or "binary".')
        text = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
        if mode == "text":
            await self.send({"type": "websocket.send", "text": text})
        else:
            await self.send({"type": "websocket.send", "bytes": text.encode("utf-8")})

    async def send_denial_response(self, response: Response) -> None:
        self._initialize_async_resources()
        assert self._send_lock is not None
        try:
            async with self._send_lock:
                if self._closed:
                    raise _websocket_disconnected(
                        'Cannot call "send" once a close message has been sent.'
                    )
                with anyio.CancelScope() as send_scope:
                    self._active_send_scope = send_scope
                    try:
                        await self.websocket.send_denial_response(response)
                    finally:
                        if self._active_send_scope is send_scope:
                            self._active_send_scope = None
                if send_scope.cancel_called:
                    raise _websocket_disconnected(
                        "WebSocket denial response was interrupted by connection close."
                    )
        finally:
            if (
                self.websocket.application_state == WebSocketState.DISCONNECTED
                and self._teardown_task is None
            ):
                self._mark_denied()
                await self._stop_background_tasks()

    def _start_receiver(self) -> None:
        if self._receive_task is None or self._receive_task.done:
            self._receive_task = _BackgroundTask(self._receive_loop)
            self._receive_task.start()

    async def _receive_loop(self) -> None:
        try:
            while not self._closed:
                assert self._transport_receive_lock is not None
                async with self._transport_receive_lock:
                    if self._closed:
                        return
                    message = await self.websocket.receive()
                if message["type"] == "websocket.disconnect":
                    code = int(message.get("code", 1000))
                    self._begin_background_teardown(
                        code, message.get("reason"), close_socket=False
                    )
                    return
                if message["type"] == "websocket.connect":
                    self._queue_message(message)
                    continue
                if self._waiting_for_pong and self._is_pong(message):
                    assert self._pong_received is not None
                    self._waiting_for_pong = False
                    self._pong_received.set()
                    continue
                if message["type"] == "websocket.receive":
                    if self._pending_message_count >= _MAX_PENDING_MESSAGES:
                        self._begin_background_teardown(
                            1013,
                            "Heartbeat message backlog exceeded",
                            close_socket=True,
                        )
                        return
                    self._message_count += 1
                    self._pending_message_count += 1
                self._queue_message(message)
        except WebSocketDisconnect as exc:
            self._begin_background_teardown(exc.code, exc.reason, close_socket=False)
        except Exception as exc:
            self._queue_message(exc)
            self._begin_background_teardown(1006, None, close_socket=False)

    async def _heartbeat_loop(self) -> None:
        next_ping_at = time.monotonic() + self.ping_interval
        try:
            while not self._closed:
                await anyio.sleep(max(0, next_ping_at - time.monotonic()))
                if self._closed:
                    return
                if self.websocket.application_state != WebSocketState.CONNECTED:
                    next_ping_at = time.monotonic() + self.ping_interval
                    continue
                try:
                    await self._send_ping()
                except Exception:
                    self._waiting_for_pong = False
                    await self._handle_send_error()
                    return
                pong_received = self._pong_received
                assert pong_received is not None
                with anyio.move_on_after(self.pong_timeout) as timeout_scope:
                    await pong_received.wait()
                if timeout_scope.cancel_called:
                    self._waiting_for_pong = False
                    await self._close_for_timeout()
                    return
                next_ping_at = max(next_ping_at, time.monotonic()) + self.ping_interval
        finally:
            self._waiting_for_pong = False

    async def _send_ping(self) -> None:
        assert self._send_lock is not None
        async with self._send_lock:
            if self._closed:
                raise _websocket_disconnected(
                    'Cannot call "send" once a close message has been sent.'
                )
            self._pong_received = anyio.Event()
            self._waiting_for_pong = True
            try:
                await self.websocket.send(
                    {"type": "websocket.send", "bytes": self.ping_message}
                )
            except WebSocketDisconnect as exc:
                await self._handle_disconnect(exc.code, exc.reason)
                raise

    async def _handle_send_error(self) -> None:
        self._begin_background_teardown(
            1001, "Heartbeat send failed", close_socket=True
        )

    async def _close_for_timeout(self) -> None:
        self._begin_background_teardown(1001, "Pong timeout", close_socket=True)

    def _begin_background_teardown(
        self, code: int, reason: str | None, *, close_socket: bool
    ) -> None:
        # Background heartbeat/receive tasks must not await teardown: teardown
        # stops those very tasks, so waiting here would deadlock (or rely on
        # cancellation to unwind). Application callers keep using the waiting
        # paths (close/_handle_disconnect); the queued disconnect unblocks them.
        if self._mark_closed(code, reason):
            self._start_teardown(close_socket=close_socket)

    def _called_from_background_task(self) -> bool:
        for task in (self._receive_task, self._heartbeat_task):
            if task is not None and not task.done:
                with suppress(Exception):
                    if task.is_current:
                        return True
        return False

    async def _handle_disconnect(self, code: int, reason: str | None = None) -> None:
        if self._called_from_background_task():
            self._begin_background_teardown(code, reason, close_socket=False)
            return
        if self._mark_closed(code, reason):
            self._start_teardown(close_socket=False)
        elif (
            self._teardown_task is not None and self._teardown_task.is_current
        ) or self._called_from_disconnect_callback():
            return
        await self._wait_for_teardown()

    def _start_teardown(self, *, close_socket: bool) -> None:
        self._initialize_async_resources()
        self._teardown_closes_socket = close_socket
        self._teardown_task = _BackgroundTask(self._run_teardown)
        self._teardown_task.start()

    async def _run_teardown(self) -> None:
        try:
            with anyio.CancelScope(shield=True):
                await self._stop_background_tasks()
                if self._teardown_closes_socket:
                    assert self._send_lock is not None
                    try:
                        async with self._send_lock:
                            await self.websocket.close(
                                code=self._close_code, reason=self._close_reason
                            )
                    except WebSocketDisconnect as exc:
                        self._close_code = exc.code
                        self._close_reason = exc.reason
                        self._teardown_error = exc
                    except Exception as exc:
                        self._close_code = 1006
                        self._close_reason = None
                        self._teardown_error = exc
                try:
                    await self._notify_disconnect()
                finally:
                    self._queue_disconnect(self._close_code, self._close_reason)
        finally:
            assert self._teardown_done is not None
            self._teardown_done.set()

    async def _wait_for_teardown(self) -> None:
        self._initialize_async_resources()
        assert self._teardown_done is not None
        await self._teardown_done.wait()

    def _mark_closed(self, code: int, reason: str | None = None) -> bool:
        if self._closed:
            return False
        self._closed = True
        self._close_code = code
        self._close_reason = reason
        self._waiting_for_pong = False
        self._ended_at = time.monotonic()
        if self._active_send_scope is not None:
            self._active_send_scope.cancel()
        for receive_scope in self._active_receive_scopes:
            receive_scope.cancel()
        return True

    def _mark_denied(self) -> None:
        if self._started_at is not None and self._ended_at is None:
            self._ended_at = time.monotonic()
        self._closed = True
        assert self._teardown_done is not None
        self._teardown_done.set()

    async def _notify_disconnect(self) -> None:
        if self._disconnect_notified:
            return
        self._disconnect_notified = True
        if self.on_disconnect is None:
            return
        token = _disconnect_callback_context.set(self)
        try:
            result = self.on_disconnect(self._close_code, self.connection_duration)
            if inspect.isawaitable(result):
                await result
        except BaseException as exc:
            if isinstance(
                exc, (KeyboardInterrupt, SystemExit, anyio.get_cancelled_exc_class())
            ):
                raise
            logger.exception("WebSocket on_disconnect callback failed")
        finally:
            _disconnect_callback_context.reset(token)

    def _called_from_disconnect_callback(self) -> bool:
        return (
            _disconnect_callback_context.get(None) is self
            and self._teardown_done is not None
            and not self._teardown_done.is_set()
        )

    async def _receive_directly(self) -> Message:
        with anyio.CancelScope() as receive_scope:
            self._active_receive_scopes.add(receive_scope)
            try:
                try:
                    assert self._transport_receive_lock is not None
                    async with self._transport_receive_lock:
                        message = await self.websocket.receive()
                except WebSocketDisconnect as exc:
                    self._active_receive_scopes.discard(receive_scope)
                    await self._handle_disconnect(exc.code, exc.reason)
                    raise
            finally:
                self._active_receive_scopes.discard(receive_scope)
        if receive_scope.cancel_called:
            return await self.receive()
        if message["type"] == "websocket.disconnect":
            await self._handle_disconnect(
                int(message.get("code", 1000)), message.get("reason")
            )
            self._disconnect_delivered = True
        elif message["type"] == "websocket.receive":
            self._message_count += 1
        return message

    def _queue_disconnect(self, code: int, reason: str | None = None) -> None:
        if self._disconnect_queued:
            return
        self._disconnect_queued = True
        self._queue_message(
            {"type": "websocket.disconnect", "code": code, "reason": reason}
        )

    def _queue_message(self, message: Message | Exception) -> None:
        self._messages.append(message)
        assert self._message_available is not None
        self._message_available.set()

    def _initialize_async_resources(self) -> None:
        if self._pong_received is None:
            self._pong_received = anyio.Event()
            self._message_available = anyio.Event()
            self._send_lock = anyio.Lock()
            self._receive_lock = anyio.Lock()
            self._transport_receive_lock = anyio.Lock()
            self._teardown_done = anyio.Event()

    def _connection_accepted(self) -> None:
        if self._started_at is None:
            self._started_at = time.monotonic()
        self._start_receiver()
        self.start_heartbeat()

    def _close_interrupted_accept(self) -> None:
        if self.websocket.application_state != WebSocketState.CONNECTED:
            return
        if self._started_at is None:
            self._started_at = time.monotonic()
        if self._mark_closed(1001, "WebSocket accept interrupted"):
            self._start_teardown(close_socket=True)

    def _ensure_connected(self) -> None:
        if self.websocket.application_state != WebSocketState.CONNECTED:
            raise _websocket_disconnected(
                'WebSocket is not connected. Need to call "accept" first.'
            )

    def _raise_if_disconnect_delivered(self) -> None:
        if self._disconnect_delivered:
            raise _websocket_disconnected(
                'Cannot call "receive" once a disconnect message has been received.'
            )

    def _is_pong(self, message: Message) -> bool:
        return cast(
            bool,
            message["type"] == "websocket.receive"
            and message.get("bytes") == self.pong_message,
        )

    @staticmethod
    def _raise_on_disconnect(message: Message) -> None:
        if message["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(
                int(message.get("code", 1000)), message.get("reason")
            )


def _websocket_disconnected(message: str) -> RuntimeError:
    exception_class: type[RuntimeError] = getattr(
        starlette.websockets, "WebSocketDisconnected", RuntimeError
    )
    return exception_class(message)


def _is_trio_backend() -> bool:
    task_module = type(anyio.get_current_task()).__module__
    return task_module.endswith("._trio")
