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
@@ -56,7 +57,6 @@
 
 
 ENCODERS_BY_TYPE: dict[type[Any], Callable[[Any], Any]] = {
-    bytes: lambda o: o.decode(),
     Color: str,
     PyExtraColor: str,
     datetime.date: isoformat,
@@ -96,6 +96,7 @@
 def jsonable_encoder(
     obj: Annotated[
         Any,
+        Doc(
             """
             The input object to convert to JSON.
             """
@@ -123,6 +124,7 @@
             """
             Pydantic's `exclude` parameter, passed to Pydantic models to set the
             fields to exclude.
+            
             """
         ),
     ] = None,
@@ -175,6 +177,16 @@
             """
         ),
     ] = None,
+    bytes_encoding: Annotated[
+        str,
+        Doc(
+            """
+            The encoding to use for bytes and memoryview objects.
+            Can be "base64" (default) or "hex".
+            """
+        ),
+    ] = "base64",
 ) -> Any:
+    if bytes_encoding not in ("base64", "hex"):
+        raise ValueError("bytes_encoding must be 'base64' or 'hex'")
+
     if exclude is not None and not isinstance(exclude, (set, dict)):
         exclude = set(exclude)
 
@@ -194,6 +206,16 @@
         return obj.value
     if isinstance(obj, Enum):
         return obj.value
+    if isinstance(obj, bytes):
+        if bytes_encoding == "base64":
+            return base64.b64encode(obj).decode("ascii")
+        else:
+            return obj.hex()
+    if isinstance(obj, memoryview):
+        bytes_data = obj.tobytes()
+        if bytes_encoding == "base64":
+            return base64.b64encode(bytes_data).decode("ascii")
+        else:
+            return bytes_data.hex()
     if isinstance(obj, PurePath):
         return str(obj)
     if isinstance(obj, (str, int, float)):
@@ -222,7 +244,7 @@
         )
         for encoder_type, encoder in ENCODERS_BY_TYPE.items():
             if isinstance(obj, encoder_type):
-                return encoder(obj)
+                return encoder(obj, bytes_encoding=bytes_encoding) if encoder_type in (bytes, memoryview) else encoder(obj)
         else:
             # Check if type has a custom origin (like Annotated, list, set, etc.)
             try:
@@ -240,7 +262,7 @@
             for class_tuple in classes_tuple:
                 for encoder_type, encoder in ENCODERS_BY_TYPE.items():
                     if isinstance(class_tuple, type) and issubclass(class_tuple, encoder_type):
-                        return encoder(obj)
+                        return encoder(obj, bytes_encoding=bytes_encoding) if encoder_type in (bytes, memoryview) else encoder(obj)
 
         try:
             # pydantic v1 style
@@ -256,7 +278,7 @@
                 )
                 for encoder_type, encoder in ENCODERS_BY_TYPE.items():
                     if isinstance(obj, encoder_type):
-                        return encoder(obj)
+                        return encoder(obj, bytes_encoding=bytes_encoding) if encoder_type in (bytes, memoryview) else encoder(obj)
                 else:
                     raise  # pragma: no cover
 
@@ -273,7 +295,7 @@
                 )
                 for encoder_type, encoder in ENCODERS_BY_TYPE.items():
                     if isinstance(obj, encoder_type):
-                        return encoder(obj)
+                        return encoder(obj, bytes_encoding=bytes_encoding) if encoder_type in (bytes, memoryview) else encoder(obj)
                 else:
                     raise  # pragma: no cover
 
@@ -283,7 +305,7 @@
                 )
                 for encoder_type, encoder in ENCODERS_BY_TYPE.items():
                     if isinstance(obj, encoder_type):
-                        return encoder(obj)
+                        return encoder(obj, bytes_encoding=bytes_encoding) if encoder_type in (bytes, memoryview) else encoder(obj)
                 else:
                     raise  # pragma: no cover
 
@@ -296,7 +318,7 @@
                 )
                 for encoder_type, encoder in ENCODERS_BY_TYPE.items():
                     if isinstance(obj, encoder_type):
-                        return encoder(obj)
+                        return encoder(obj, bytes_encoding=bytes_encoding) if encoder_type in (bytes, memoryview) else encoder(obj)
                 else:
                     raise  # pragma: no cover
 
@@ -309,7 +331,7 @@
                 )
                 for encoder_type, encoder in ENCODERS_BY_TYPE.items():
                     if isinstance(obj, encoder_type):
-                        return encoder(obj)
+                        return encoder(obj, bytes_encoding=bytes_encoding) if encoder_type in (bytes, memoryview) else encoder(obj)
                 else:
                     raise  # pragma: no cover
 
@@ -319,7 +341,7 @@
                 )
                 for encoder_type, encoder in ENCODERS_BY_TYPE.items():
                     if isinstance(obj, encoder_type):
-                        return encoder(obj)
+                        return encoder(obj, bytes_encoding=bytes_encoding) if encoder_type in (bytes, memoryview) else encoder(obj)
                 else:
                     raise  # pragma: no cover
 
@@ -329,7 +351,7 @@
                 )
                 for encoder_type, encoder in ENCODERS_BY_TYPE.items():
                     if isinstance(obj, encoder_type):
-                        return encoder(obj)
+                        return encoder(obj, bytes_encoding=bytes_encoding) if encoder_type in (bytes, memoryview) else encoder(obj)
                 else:
                     raise  # pragma: no cover
 
@@ -339,7 +361,7 @@
                 )
                 for encoder_type, encoder in ENCODERS_BY_TYPE.items():
                     if isinstance(obj, encoder_type):
-                        return encoder(obj)
+                        return encoder(obj, bytes_encoding=bytes_encoding) if encoder_type in (bytes, memoryview) else encoder(obj)
                 else:
                     raise  # pragma: no cover
 
@@ -349,7 +371,7 @@
                 )
                 for encoder_type, encoder in ENCODERS_BY_TYPE.items():
                     if isinstance(obj, encoder_type):
-                        return encoder(obj)
+                        return encoder(obj, bytes_encoding=bytes_encoding) if encoder_type in (bytes, memoryview) else encoder(obj)
                 else:
                     raise  # pragma: no cover
 
@@ -359,7 +381,7 @@
                 )
                 for encoder_type, encoder in ENCODERS_BY_TYPE.items():
                     if isinstance(obj, encoder_type):
-                        return encoder(obj)
+                        return encoder(obj, bytes_encoding=bytes_encoding) if encoder_type in (bytes, memoryview) else encoder(obj)
                 else:
                     raise  # pragma: no cover
 
@@ -369,7 +391,7 @@