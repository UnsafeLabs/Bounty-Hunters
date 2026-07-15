import re
from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError, WebSocketRequestValidationError
from fastapi.utils import is_body_allowed_for_status_code
from fastapi.websockets import WebSocket
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.status import WS_1008_POLICY_VIOLATION

SENSITIVE_FIELD_PATTERN = re.compile(r"(?i)password|secret|token|api_key", re.IGNORECASE)

def _redact_sensitive(data: dict | list | Any, depth: int = 0) -> dict | list | Any:
    """Recursively redact sensitive fields. Max depth 10."""
    if depth > 10:
        return data
    if isinstance(data, dict):
        return {
            k: "***REDACTED***" if isinstance(k, str) and SENSITIVE_FIELD_PATTERN.search(k) else _redact_sensitive(v, depth + 1)
            for k, v in data.items()
        }
    if isinstance(data, list):
        return [_redact_sensitive(item, depth + 1) for item in data]
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
    error_response: dict[str, Any] = {
        "detail": jsonable_encoder(exc.errors()),
        "path": request.url.path,
        "method": request.method,
    }
    # Include body in debug mode with redaction
    app = getattr(request.app, "debug", False)
    if app:
        try:
            body = await request.json()
            error_response["body"] = _redact_sensitive(body)
        except Exception:
            try:
                body_bytes = await request.body()
                if body_bytes:
                    error_response["body"] = "[non-JSON body omitted]"
            except Exception:
                pass
    return JSONResponse(status_code=422, content=error_response)


async def websocket_request_validation_exception_handler(
    websocket: WebSocket, exc: WebSocketRequestValidationError
) -> None:
    await websocket.close(
        code=WS_1008_POLICY_VIOLATION, reason=jsonable_encoder(exc.errors())
    )
