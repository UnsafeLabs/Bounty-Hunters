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
@@ -97,7 +98,6 @@
 
 
 ENCODERS_BY_TYPE: dict[type[Any], Callable[[Any], Any]] = {
-    bytes: lambda o: o.decode(),
     Color: str,
     PyExtraColor: str,
     datetime.date: isoformat,
@@ -145,6 +145,7 @@
             """
         ),
     ] = None,
+    bytes_encoding: Annotated[str, Doc("""The encoding to use for bytes objects. Defaults to "base64". Can be "base64" or "hex".""")] = "base64",
 ) -> Any:
     """
     Convert any object to something that can be exposed in JSON.
@@ -162,6 +163,16 @@
     if isinstance(obj, Enum):
         return obj.value
     if isinstance(obj, bytes):
-        return obj.decode()
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
     if isinstance(obj, dict):
         encoded_dict = {}
         allowed_keys = set(obj.keys())
@@ -224,7 +235,7 @@
         )
         for k, v in obj.items():
             k = (
-                jsonable_encoder(
+                jsonable_encoder(  # type: ignore[assignment]
                     k,
                     custom_encoder=custom_encoder,
                     exclude_none=exclude_none,
@@ -233,7 +244,7 @@
                 if isinstance(k, Enum)
                 else k
             )
-            v = jsonable_encoder(
+            v = jsonable_encoder(  # type: ignore[assignment]
                 v,
                 custom_encoder=custom_encoder,
                 exclude_none=exclude_none,
@@ -254,7 +265,7 @@
             )
         )
         for k, v in obj:
-            k = jsonable_encoder(
+            k = jsonable_encoder(  # type: ignore[assignment]
                 k,
                 custom_encoder=custom_encoder,
                 exclude_none=exclude_none,
@@ -263,7 +274,7 @@
                 if isinstance(k, Enum)
                 else k
             )
-            v = jsonable_encoder(
+            v = jsonable_encoder(  # type: ignore[assignment]
                 v,
                 custom_encoder=custom_encoder,
                 exclude_none=exclude_none,
@@ -283,7 +294,7 @@
             )
         )
         for k, v in obj:
-            k = jsonable_encoder(
+            k = jsonable_encoder(  # type: ignore[assignment]
                 k,
                 custom_encoder=custom_encoder,
                 exclude_none=exclude_none,
@@ -292,7 +303,7 @@
                 if isinstance(k, Enum)
                 else k
             )
-            v = jsonable_encoder(
+            v = jsonable_encoder(  # type: ignore[assignment]
                 v,
                 custom_encoder=custom_encoder,
                 exclude_none=exclude_none,
@@ -312,7 +323,7 @@
             )
         )
         for k, v in obj:
-            k = jsonable_encoder(
+            k = jsonable_encoder(  # type: ignore[assignment]
                 k,
                 custom_encoder=custom_encoder,
                 exclude_none=exclude_none,
@@ -321,7 +332,7 @@
                 if isinstance(k, Enum)
                 else k
             )
-            v = jsonable_encoder(
+            v = jsonable_encoder(  # type: ignore[assignment]
                 v,
                 custom_encoder=custom_encoder,
                 exclude_none=exclude_none,
@@ -341,7 +352,7 @@
             )
         )
         for k, v in obj:
-            k = jsonable_encoder(
+            k = jsonable_encoder(  # type: ignore[assignment]
                 k,
                 custom_encoder=custom_encoder,
                 exclude_none=exclude_none,
@@ -350,7 +361,7 @@
                 if isinstance(k, Enum)
                 else k
             )
-            v = jsonable_encoder(
+            v = jsonable_encoder(  # type: ignore[assignment]
                 v,
                 custom_encoder=custom_encoder,
                 exclude_none=exclude_none,
@@ -370,7 +381,7 @@
             )
         )
         for k, v in obj:
-            k = jsonable_encoder(
+            k = jsonable_encoder(  # type: ignore[assignment]
                 k,
                 custom_encoder=custom_encoder,
                 exclude_none=exclude_none,
@@ -379,7 +390,7 @@
                 if isinstance(k, Enum)
                 else k
             )
-            v = jsonable_encoder(
+            v = jsonable_encoder(  # type: ignore[assignment]
                 v,
                 custom_encoder=custom_encoder,
                 exclude_none=exclude_none,
@@ -399,7 +410,7 @@
             )
         )
         for k, v in obj:
-            k = jsonable_encoder(
+            k = jsonable_encoder(  # type: ignore[assignment]
                 k,
                 custom_encoder=custom_encoder,
                 exclude_none=exclude_none,
@@ -408,7 +419,7 @@
                 if isinstance(k, Enum)
                 else k
             )
-            v = jsonable_encoder(
+            v = jsonable_encoder(  # type: ignore[assignment]
                 v,
                 custom_encoder=custom_encoder,
                 exclude_none=exclude_none,
@@ -428,7 +439,7 @@
             )
         )
         for k, v in obj:
-            k = jsonable_encoder(
+            k = jsonable_encoder(  # type: ignore[assignment]
                 k,
                 custom_encoder=custom_encoder,
                 exclude_none=exclude_none,
@@ -437,7 +448,7 @@
                 if isinstance(k, Enum)
                 else k
             )
-            v = jsonable_encoder(
+            v = jsonable_encoder(  # type: ignore[assignment]
                 v,
                 custom_encoder=custom_encoder,
                 exclude_none=exclude_none,
@@ -457,7 +468,7 @@
             )
         )
         for k, v in obj:
-            k = jsonable_encoder(
+            k = jsonable_encoder(  # type: ignore[assignment]
                 k,
                 custom_encoder=custom_encoder,
                 exclude_none=exclude_none,
@@ -466,7 +477,7 @@
                 if isinstance(k, Enum)
                 else k
             )
-            v = jsonable_encoder(
+            v = jsonable_encoder(  # type: ignore[assignment]
                 v,
                 custom