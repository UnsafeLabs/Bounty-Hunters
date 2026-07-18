from collections.abc import Mapping

from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError, WebSocketRequestValidationError
from fastapi.utils import is_body_allowed_for_status_code
from fastapi.websockets import WebSocket
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.status import WS_1008_POLICY_VIOLATION

SENSITIVE_FIELDS = {"password", "secret", "token", "api_key"}


def _redact_sensitive(data: object) -> object:
    if isinstance(data, Mapping):
        return {k: _redact_sensitive(v) if k.lower() in SENSITIVE_FIELDS else v for k, v in data.items()}
    if isinstance(data, list):
        return [_redact_sensitive(item) for item in data]
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
    content: dict[str, object] = {
        "detail": jsonable_encoder(exc.errors()),
        "path": request.url.path,
        "method": request.method,
    }
    debug = getattr(request.app, "debug", False)
    if debug:
        try:
            body = await request.json()
            content["body"] = _redact_sensitive(body)
        except Exception:
            try:
                raw = await request.body()
                if raw:
                    content["body"] = raw.decode("utf-8", errors="replace")
            except Exception:
                pass
    return JSONResponse(
        status_code=422,
        content=jsonable_encoder(content),
    )


async def websocket_request_validation_exception_handler(
    websocket: WebSocket, exc: WebSocketRequestValidationError
) -> None:
    await websocket.close(
        code=WS_1008_POLICY_VIOLATION, reason=jsonable_encoder(exc.errors())
    )
