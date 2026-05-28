import copy
from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError, WebSocketRequestValidationError
from fastapi.utils import is_body_allowed_for_status_code
from fastapi.websockets import WebSocket
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.status import WS_1008_POLICY_VIOLATION

# Field names whose values should be redacted in debug error responses
_SENSITIVE_FIELDS = frozenset({"password", "secret", "token", "api_key", "api_secret"})


def _redact_sensitive_fields(data: Any) -> Any:
    """
    Recursively replace values of sensitive field names with '***REDACTED***'.

    Handles dicts (including nested) and lists of dicts.
    """
    if isinstance(data, dict):
        redacted = {}
        for key, value in data.items():
            if isinstance(key, str) and key.lower() in _SENSITIVE_FIELDS:
                redacted[key] = "***REDACTED***"
            else:
                redacted[key] = _redact_sensitive_fields(value)
        return redacted
    elif isinstance(data, list):
        return [_redact_sensitive_fields(item) for item in data]
    return data


async def http_exception_handler(request: Request, exc: HTTPException) -> Response:
    headers = getattr(exc, "headers", None)
    if not is_body_allowed_for_status_code(exc.status_code):
        return Response(status_code=exc.status_code, headers=headers)
    return JSONResponse(
        {"detail": exc.detail}, status_code=exc.status_code, headers=headers
    )


async def request_validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    content: dict[str, Any] = {
        "detail": jsonable_encoder(exc.errors()),
        "path": request.url.path,
        "method": request.method,
    }

    # Include the request body in debug mode (when app.debug is True)
    if getattr(request.app, "debug", False):
        try:
            body_bytes = await request.body()
            if body_bytes:
                import json

                try:
                    body_data = json.loads(body_bytes)
                    body_data = _redact_sensitive_fields(body_data)
                    content["body"] = body_data
                except (json.JSONDecodeError, UnicodeDecodeError):
                    content["body"] = "<unable to decode body>"
        except Exception:
            content["body"] = "<unable to read body>"

    return JSONResponse(
        status_code=422,
        content=content,
    )


async def websocket_request_validation_exception_handler(
    websocket: WebSocket, exc: WebSocketRequestValidationError
) -> None:
    await websocket.close(
        code=WS_1008_POLICY_VIOLATION, reason=jsonable_encoder(exc.errors())
    )
