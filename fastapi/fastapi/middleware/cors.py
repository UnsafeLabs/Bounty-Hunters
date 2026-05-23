from starlette.middleware.cors import CORSMiddleware as CORSMiddleware  # noqa


from starlette.middleware.cors import CORSMiddleware as _CORSMiddleware


class DynamicCORSMiddleware(_CORSMiddleware):
    def __init__(self, app, allow_origin_func=None, allow_origins=None, allow_methods=None,
                 allow_headers=None, allow_credentials=False, allow_origin_regex=None,
                 expose_headers=None, max_age=600, cors_max_age=None):
        if cors_max_age is not None:
            max_age = cors_max_age
        super().__init__(
            app=app,
            allow_origins=allow_origins or [],
            allow_methods=allow_methods or [],
            allow_headers=allow_headers or [],
            allow_credentials=allow_credentials,
            allow_origin_regex=allow_origin_regex,
            expose_headers=expose_headers or [],
            max_age=max_age,
        )
        self.allow_origin_func = allow_origin_func

    def is_allowed_origin(self, origin: str) -> bool:
        if self.allow_origin_func:
            result = self.allow_origin_func(origin)
            if hasattr(result, "__await__"):
                import anyio
                return anyio.run(result)
            return bool(result)
        return super().is_allowed_origin(origin)
