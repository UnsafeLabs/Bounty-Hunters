```diff
--- a/fastapi/fastapi/routing.py
+++ b/fastapi/fastapi/routing.py
@@ -1,5 +1,6 @@
 import asyncio
 import dataclasses
+import inspect
 import enum
 import logging
 import os
@@ -15,6 +16,7 @@
 from fastapi.datastructures import Default, DefaultPlaceholder
 from fastapi.dependencies.models import Dependant
 from fastapi.dependencies.utils import get_dependant, solve_dependencies
+from fastapi.encoders import jsonable_encoder
 from fastapi.exception_handlers import (
     request_validation_exception_handler,
     websocket_request_validation_exception_handler,
@@ -24,6 +26,7 @@
 from fastapi.types import DecoratedCallable, IncEx
 from fastapi.utils import create_cloned_field, create_response_field, generate_unique_id
 from pydantic import BaseModel
+from starlette.middleware import Middleware
 from starlette.responses import JSONResponse, Response
 from starlette.routing import BaseRoute, Match, compile_path, request_response
 from starlette.types import ASGIApp, Lifespan, Receive, Scope, Send
@@ -43,6 +46,7 @@
     response_class: Union[Type[Response], DefaultPlaceholder] = Default(JSONResponse),
     name: Optional[str] = None,
     callbacks: Optional[List[BaseRoute]] = None,
+    middleware: Optional[List[Union[Middleware, Callable]]] = None,
 ) -> Callable[[DecoratedCallable], DecoratedCallable]:
     def decorator(func: DecoratedCallable) -> DecoratedCallable:
         self.add_api_route(
@@ -53,6 +57,7 @@
             response_class=response_class,
             name=name,
             callbacks=callbacks,
+            middleware=middleware,
         )
         return func
 
@@ -68,6 +73,7 @@
     response_class: Union[Type[Response], DefaultPlaceholder] = Default(JSONResponse),
     name: Optional[str] = None,
     callbacks: Optional[List[BaseRoute]] = None,
+    middleware: Optional[List[Union[Middleware, Callable]]] = None,
 ) -> Callable[[DecoratedCallable], DecoratedCallable]:
     def decorator(func: DecoratedCallable) -> DecoratedCallable:
         self.add_api_route(
@@ -78,6 +84,7 @@
             response_class=response_class,
             name=name,
             callbacks=callbacks,
+            middleware=middleware,
         )
         return func
 
@@ -93,6 +100,7 @@
     response_class: Union[Type[Response], DefaultPlaceholder] = Default(JSONResponse),
     name: Optional[str] = None,
     callbacks: Optional[List[BaseRoute]] = None,
+    middleware: Optional[List[Union[Middleware, Callable]]] = None,
 ) -> Callable[[DecoratedCallable], DecoratedCallable]:
     def decorator(func: DecoratedCallable) -> DecoratedCallable:
         self.add_api_route(
@@ -103,6 +111,7 @@
             response_class=response_class,
             name=name,
             callbacks=callbacks,
+            middleware=middleware,
         )
         return func
 
@@ -118,6 +127,7 @@
     response_class: Union[Type[Response], DefaultPlaceholder] = Default(JSONResponse),
     name: Optional[str] = None,
     callbacks: Optional[List[BaseRoute]] = None,
+    middleware: Optional[List[Union[Middleware, Callable]]] = None,
 ) -> Callable[[DecoratedCallable], DecoratedCallable]:
     def decorator(func: DecoratedCallable) -> DecoratedCallable:
         self.add_api_route(
@@ -128,6 +138,7 @@
             response_class=response_class,
             name=name,
             callbacks=callbacks,
+            middleware=middleware,
         )
         return func
 
@@ -143,6 +154,7 @@
     response_class: Union[Type[Response], DefaultPlaceholder] = Default(JSONResponse),
     name: Optional[str] = None,
     callbacks: Optional[List[BaseRoute]] = None,
+    middleware: Optional[List[Union[Middleware, Callable]]] = None,
 ) -> Callable[[DecoratedCallable], DecoratedCallable]:
     def decorator(func: DecoratedCallable) -> DecoratedCallable:
         self.add_api_route(
@@ -153,6 +165,7 @@
             response_class=response_class,
             name=name,
             callbacks=callbacks,
+            middleware=middleware,
         )
         return func
 
@@ -168,6 +181,7 @@
     response_class: Union[Type[Response], DefaultPlaceholder] = Default(JSONResponse),
     name: Optional[str] = None,
     callbacks: Optional[List[BaseRoute]] = None,
+    middleware: Optional[List[Union[Middleware, Callable]]] = None,
 ) -> Callable[[DecoratedCallable], DecoratedCallable]:
     def decorator(func: DecoratedCallable) -> DecoratedCallable:
         self.add_api_route(
@@ -178,6 +192,7 @@
             response_class=response_class,
             name=name,
             callbacks=callbacks,
+            middleware=middleware,
         )
         return func
 
@@ -193,6 +208,7 @@
     response_class: Union[Type[Response], DefaultPlaceholder] = Default(JSONResponse),
     name: Optional[str] = None,
     callbacks: Optional[List[BaseRoute]] = None,
+    middleware: Optional[List[Union[Middleware, Callable]]] = None,
 ) -> Callable[[DecoratedCallable], DecoratedCallable]:
     def decorator(func: DecoratedCallable) -> DecoratedCallable:
         self.add_api_route(
@@ -203,6 +219,7 @@
             response_class=response_class,
             name=name,
             callbacks=callbacks,
+            middleware=middleware,
         )
         return func
 
@@ -218,6 +235,7 @@
     response_class: Union[Type[Response], DefaultPlaceholder] = Default(JSONResponse),
     name: Optional[str] = None,
     callbacks: Optional[List[BaseRoute]] = None,
+    middleware: Optional[List[Union[Middleware, Callable]]] = None,
 ) -> Callable[[DecoratedCallable], DecoratedCallable]:
     def decorator(func: DecoratedCallable) -> DecoratedCallable:
         self.add_api_route(
@@ -228,6 +246,7 @@
             response_class=response_class,
             name=name,
             callbacks=callbacks,
+            middleware=middleware,
         )
         return func
 
@@ -243,6 +262,7 @@
     response_class: