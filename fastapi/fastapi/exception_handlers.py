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
    errors = exc.errors()
    redacted_errors = []
    for err in errors:
        err_copy = dict(err)
        ctx = err_copy.get("ctx")
        if ctx:
            redacted_ctx = {}
            for k, v in ctx.items():
                if isinstance(v, str) and len(v) > 100:
                    redacted_ctx[k] = "[REDACTED]"
                else:
                    redacted_ctx[k] = v
            err_copy["ctx"] = redacted_ctx
        redacted_errors.append(err_copy)

    return JSONResponse(
        status_code=422,
        content={
            "detail": jsonable_encoder(redacted_errors),
            "request": {
                "method": request.method,
                "url": str(request.url),
                "path": request.url.path,
            },
        },
    )


async def websocket_request_validation_exception_handler(
    websocket: WebSocket, exc: WebSocketRequestValidationError
) -> None:
    await websocket.close(
        code=WS_1008_POLICY_VIOLATION, reason=jsonable_encoder(exc.errors())
    )
