"""
Router-level middleware support for FastAPI.

Allows attaching middleware to specific APIRouter instances
instead of the entire application, enabling per-route middleware chains.
"""
from typing import Callable, List, Optional, Any
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from fastapi import FastAPI, APIRouter


class RouterMiddleware:
    """
    Middleware that only applies to routes under a specific APIRouter prefix.
    
    Usage:
        router = APIRouter(prefix="/api")
        middleware = RouterMiddleware(rate_limit_middleware)
        router.add_middleware(RouterMiddleware, middleware=middleware)
    """
    
    def __init__(self, middleware_func: Callable):
        self.middleware_func = middleware_func

    async def __call__(self, request: Request, call_next: Callable) -> Response:
        return await self.middleware_func(request, call_next)


class MiddlewareChain:
    """
    Chain of middleware functions to be applied in order.
    
    Usage:
        chain = MiddlewareChain()
        chain.use(auth_middleware)
        chain.use(rate_limit_middleware)
        
        # Apply to a router
        chain.apply_to(router)
    """
    
    def __init__(self):
        self._middleware: List[Callable] = []
    
    def use(self, middleware_func: Callable) -> "MiddlewareChain":
        """Add middleware to the chain. Returns self for fluent API."""
        self._middleware.append(middleware_func)
        return self
    
    def apply_to(self, router: APIRouter) -> APIRouter:
        """
        Apply the middleware chain to an APIRouter.
        
        This wraps each route in the router with the middleware chain,
        so middleware only applies to routes under this router.
        """
        original_routes = router.routes.copy()
        
        for route in original_routes:
            if hasattr(route, "endpoint"):
                original_endpoint = route.endpoint
                chain = self._middleware.copy()
                
                async def chained_endpoint(*args, __original=original_endpoint, __chain=chain, **kwargs):
                    # Build the middleware chain from inside out
                    async def inner_call_next(request: Request):
                        return await __original(request)
                    
                    call_next = inner_call_next
                    for mw in reversed(__chain):
                        prev_call_next = call_next
                        async def make_call_next(request, _mw=mw, _next=prev_call_next):
                            return await _mw(request, _next)
                        call_next = make_call_next
                    
                    # We need the request object from the route handler
                    return await call_next_next(request)
                
                # This is a simplified version — full implementation would
                # need to handle dependency injection properly
                route.endpoint = chained_endpoint
        
        return router
    
    @property
    def middleware(self) -> List[Callable]:
        return self._middleware.copy()


def apply_router_middleware(
    router: APIRouter,
    *middleware_funcs: Callable,
) -> APIRouter:
    """
    Convenience function to apply middleware to a router.
    
    Usage:
        router = apply_router_middleware(
            my_router,
            auth_middleware,
            rate_limit_middleware,
        )
    """
    chain = MiddlewareChain()
    for mw in middleware_funcs:
        chain.use(mw)
    return chain.apply_to(router)


def create_path_middleware(
    path_prefix: str,
    middleware_func: Callable,
) -> Callable:
    """
    Create middleware that only applies to paths matching a prefix.
    
    Usage:
        app.add_middleware(
            BaseHTTPMiddleware,
            dispatch=create_path_middleware("/api", api_auth_middleware)
        )
    """
    async def path_middleware(request: Request, call_next: Callable) -> Response:
        if request.url.path.startswith(path_prefix):
            return await middleware_func(request, call_next)
        return await call_next(request)
    
    return path_middleware
