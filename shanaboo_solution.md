 ```diff
--- a/fastapi/fastapi/encoders.py
+++ b/fastapi/fastapi/encoders.py
@@ -1,5 +1,6 @@
 import dataclasses
 import datetime
+import base64
 from collections import defaultdict, deque
 from collections.abc import Callable
 from decimal import Decimal
@@ -55,7 +56,6 @@
 
 
 ENCODERS_BY_TYPE: dict[type[Any], Callable[[Any], Any]] = {
-    bytes: lambda o: o.decode(),
     Color: str,
     PyExtraColor: str,
     datetime.date: isoformat,
@@ -115,6 +115,16 @@
             The input object to convert to JSON.
             """
         ),
+    ],
+    bytes_encoding: Annotated[
+        str,
+        Doc(
+            """
+            The encoding to use for bytes and memoryview objects.
+            Can be "base64" or "hex".
+            """
        ),
+    ] = "base64",
     include: Annotated[
         IncEx | None,
         Doc(
@@ -171,6 +181,7 @@
     ] = None,
     sqlalchemy_safe: bool = True,
     type_encoders: type[dict[Any, Callable[[Any], Any]]] | None = None,
+    bytes_encoding: str = "base64",
 ) -> Any:
     if include is not None and not isinstance(include, (set, dict)):
         include = set(include)
@@ -195,6 +206,18 @@
         return obj.value
     if isinstance(obj, Enum):
         return obj.value
+    if isinstance(obj, bytes):
+        if bytes_encoding == "hex":
+            return obj.hex()
+        else:
+            return base64.b64encode(obj).decode("ascii")
+    if isinstance(obj, memoryview):
+        obj_bytes = obj.tobytes()
+        if bytes_encoding == "hex":
+            return obj_bytes.hex()
+        else:
+            return base64.b64encode(obj_bytes).decode("ascii")
     if isinstance(obj, PurePath):
         return str(obj)
     if isinstance(obj, (str, int, float, type(None))):
@@ -224,6 +247,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -240,6 +264,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -258,6 +283,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -277,6 +303,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -296,6 +323,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -316,6 +344,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 pydantic_models=pydantic_models,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -334,6 +363,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -353,6 +383,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -372,6 +403,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -391,6 +423,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -410,6 +443,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -429,6 +463,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -448,6 +483,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -467,6 +503,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -486,6 +523,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -505,6 +543,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -524,6 +563,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -543,6 +583,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -562,6 +603,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -581,6 +623,7 @@
                 exclude_none=exclude_none,
                 include=include,
                 exclude=exclude,
+                bytes_encoding=bytes_encoding,
             )
             if isinstance(data, dict):
                 encoded_object = data
@@ -600,6 +643,7 @@
                 exclude_none=