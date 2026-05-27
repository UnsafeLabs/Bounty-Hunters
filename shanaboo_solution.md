```diff
--- a/fastapi/fastapi/responses.py
+++ b/fastapi/fastapi/responses.py
+++ b/fastapi/fastapi/responses.py
@@ -1,3 +1,10 @@
+import csv
+import io
+from typing import Any, AsyncGenerator, Callable, Dict, Optional, Union, AsyncIterator
 from typing import Any, Protocol, cast
+from starlette.background import BackgroundTask
+from starlette.datastructures import MutableHeaders
+from starlette.types import Receive, Scope, Send
+import urllib.parse
 
 from fastapi.exceptions import FastAPIDeprecationWarning
@@ -21,3 +28,10 @@
 from starlette.responses import StreamingResponse as StreamingResponse  # noqa
 from typing_extensions import deprecated
+from starlette.responses import Response as StarletteResponse
+import csv
+import io
+from typing import List
+
 
 class _UjsonModule(Protocol):
@@ -42,3 +52,3 @@
     orjson = None  # type: ignore[assignment]
 
-@deprecated(
+class StreamingCSVResponse(StarletteResponse):
+    """
+    Streaming response class for CSV content.
+    """
+    def __init__(
+        self,
+        content: Optional[Any] = None,
+        status_code: int = 200,
+        headers: Optional[Dict[str, str]] = None,
+        media_type: str = "text/csv",
+        background: Optional[BackgroundTask] = None,
+        filename: str = "data.csv",
+        content_disposition: str = "attachment",
+        headers_row: Optional[List[str]] = None,  # Optional list of column names for the header row
+        delimiter: str = ",",
+    ) -> None:
+        super().__init__(content=content, status_code=status_code, headers=headers, media_type=media_type, background=background)
+        self.filename = filename
+        self.content_disposition = content_disposition
+        self.headers_row = headers_row
+        self.delimiter = delimiter
+
+    async def stream_response(self, send: Send) -> None:
+        """Stream the CSV data."""
+        if self.content_disposition == "inline":
+            content_disposition_value = f"inline; filename={self.filename}"
+        else:
+            content_disposition_value = f'attachment; filename="{self.filename}"'
+        headers = MutableHeaders(raw=[])
+        headers["content-type"] = "text/csv"
+        headers["content-disposition"] = content_disposition_value
+        await send({"type": "http.response.start", "status": self.status_code, "headers": headers.raw})
+        # Send the header row if specified
+        if self.headers_row:
+            output = io.StringIO()
+            writer = csv.writer(output, delimiter=self.delimiter, quotechar='"', quoting=csv.QUOTE_MINIMAL)
+            writer.writerow(self.headers_row)
+            await send({"type": "http.response.body", "body": output.getvalue().encode("utf-8")})
+        await send({"type": "http.response.body", "body": b"", "more_body": True})
+        async for data in self.body_iterator:
+            output = io.StringIO()
+            writer = csv.writer(output, delimiter=self.delimiter, quotechar='"', quoting=csv.QUOTE_MINIMAL)
+            for row in data:
+                writer.writerow(row)
+            csv_content = output.getvalue().encode("utf-8")
+            await send({"type": "http.response.body", "body": csv_content, "more_body": True})
+        await send({"type": "http.response.body", "body": b"", "more_body": False})
+
+    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
+        await self.stream_response(send)
+
+    async def listen_for_disconnect(self, receive: Receive) -> None:
+        """Handle client disconnect."""
+        while True:
+            message = await receive()
+            if message["type"] == "http.disconnect":
+                return
+            if message["type"] == "http.response.body":
+                break
+        await self.stream_response(send)
+
+    def __init_subclass__(cls, **kwargs):
+        """Allow subclasses to modify the base class behavior."""
+        super().__init_subclass__(**kwargs)
+
+    def __init__(
+        self,
+        content: Optional[Any] = None,
+        status_code: int = 200,
+        headers: Optional[Dict[str, str]] = None,
+        media_type: str = "text/csv",
+        background: Optional[BackgroundTask] = None,
+        filename: str = "data.csv",
+        content_disposition: str = "attachment",
+        headers_row: Optional[List[str]] = None,
+        delimiter: str = ",",
+    ) -> None:
+        super().__init__(content=content, status_code=status_code, headers=headers, media_type=media_type, background=background)
+        self.filename = filename
+        self.content_disposition = content_disposition
+        self.headers_row = headers_row
+        self.delimiter = delimiter
+
+    async def stream_response(self, send: Send) -> None:
+        """Stream the CSV data."""
+        if self.content_disposition == "inline":
+            content_disposition_value = f"inline; filename={self.filename}"
+        else:
+            content_disposition_value = f'attachment; filename="{self.filename}"'
+        headers = MutableHeaders(raw=[])
+        headers["content-type"] = "text/csv"
+        headers["content-disposition"] = content_disposition_value
+        await send({"type": "http.response.start", "status": self.status_code, "headers": headers.raw})
+        # Send the header row if specified
+        if self.headers_row:
+            output = io.StringIO()
+            writer_header = csv.writer(output, delimiter=self.delimiter)
+            writer_header.writerow(self.headers_row)
+            await send({"type": "http.response.body", "body": output.getvalue().encode("utf-8"), "more_body": True})
+        await send({"type": "http.response.body", "body": b"", "more_body": True})
+        async for data in self.body_iterator:
+            output = io.StringIO()
+            writer = csv.writer(output, delimiter=self.delimiter)
+            for row in data:
+                writer.writerow(row)
+            csv_content = output.getvalue().encode("utf-8")
+            await send({"type": "http.response.body", "body": csv_content, "more_body": True})
+        await send({"type": "http.response.body", "body": b"", "more_body": False})
+
+    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
+        await self.stream_response(send)
+
+