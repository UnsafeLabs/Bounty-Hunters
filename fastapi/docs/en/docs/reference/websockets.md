# WebSockets

When defining WebSockets, you normally declare a parameter of type `WebSocket` and with it you can read data from the client and send data to it.

Read more about it in the [FastAPI docs for WebSockets](https://fastapi.tiangolo.com/advanced/websockets/)

It is provided directly by Starlette, but you can import it from `fastapi`:

```python
from fastapi import WebSocket
```

/// tip

When you want to define dependencies that should be compatible with both HTTP and WebSockets, you can define a parameter that takes an `HTTPConnection` instead of a `Request` or a `WebSocket`.

///

::: fastapi.WebSocket
    options:
        members:
            - scope
            - app
            - url
            - base_url
            - headers
            - query_params
            - path_params
            - cookies
            - client
            - state
            - url_for
            - client_state
            - application_state
            - receive
            - send
            - accept
            - receive_text
            - receive_bytes
            - receive_json
            - iter_text
            - iter_bytes
            - iter_json
            - send_text
            - send_bytes
            - send_json
            - close

## WebSockets - additional classes

Additional classes for handling WebSockets.

Provided directly by Starlette, but you can import it from `fastapi`:

```python
from fastapi.websockets import WebSocketDisconnect, WebSocketState
```

::: fastapi.websockets.WebSocketDisconnect

When a client disconnects, a `WebSocketDisconnect` exception is raised, you can catch it.

You can import it directly form `fastapi`:

```python
from fastapi import WebSocketDisconnect
```

Read more about it in the [FastAPI docs for WebSockets](https://fastapi.tiangolo.com/advanced/websockets/#handling-disconnections-and-multiple-clients)

::: fastapi.websockets.WebSocketState

`WebSocketState` is an enumeration of the possible states of a WebSocket connection.

## WebSocket heartbeat

`WebSocketWithHeartbeat` is an opt-in wrapper that sends configurable heartbeat
messages, closes stale connections, and records connection metrics. Existing
`WebSocket` connections are unchanged.

ASGI doesn't expose protocol-level ping and pong control frames to applications.
The wrapper therefore sends `b"ping"` as a binary application message. The client
must reply with the binary message `b"pong"` before `pong_timeout` expires.

```python
from fastapi import FastAPI, WebSocket, WebSocketWithHeartbeat

app = FastAPI()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    heartbeat = WebSocketWithHeartbeat(
        websocket,
        ping_interval=30,
        pong_timeout=10,
    )
    await heartbeat.accept()
    message = await heartbeat.receive_text()
    await heartbeat.send_text(message)
```

The optional `on_disconnect` callback receives the close code and connection
duration in seconds. It can be synchronous or asynchronous. The
`connection_duration` property reports elapsed connected time, while
`message_count` reports non-heartbeat messages received from the client.

::: fastapi.websockets.WebSocketWithHeartbeat
