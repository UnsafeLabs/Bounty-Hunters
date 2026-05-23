from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError, WebSocketRequestValidationError
from fastapi.utils import is_body_allowed_for_status_code
from fastapi.websockets import WebSocket
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.status import WS_1008_POLICY_VIOLATION


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

    if getattr(request.app, "debug", False):
        def redact(data: Any) -> Any:
            if isinstance(data, dict):
                return {
                    k: "***REDACTED***" if k.lower() in {"password", "secret", "token", "api_key"} else redact(v)
                    for k, v in data.items()
                }
            elif isinstance(data, list):
                return [redact(item) for item in data]
            return data

        try:
            content["body"] = redact(exc.body)
        except Exception:
            pass

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
