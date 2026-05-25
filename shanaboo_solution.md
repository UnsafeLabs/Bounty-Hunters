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
@@ -78,7 +79,6 @@
 
 
 ENCODERS_BY_TYPE: dict[type[Any], Callable[[Any], Any]] = {
-    bytes: lambda o: o.decode(),
     Color: str,
     PyExtraColor: str,
     datetime.date: isoformat,
@@ -121,6 +121,7 @@
     obj: Annotated[
         Any,
         Doc(
+            """
             The input object to convert to JSON.
             """
         ),
@@ -166,6 +167,15 @@
             """
         ),
     ] = None,
+    bytes_encoding: Annotated[
+        str,
+        Doc(
+            """
+            The encoding to use for bytes and memoryview objects.
+            Can be "base64" or "hex".
+            """
+        ),
+    ] = "base64",
 ) -> Any:
     if isinstance(obj, BaseModel):
         # TODO: remove when deprecating Pydantic v1
@@ -222,6 +232,17 @@
             return encoded_list
         if isinstance(obj, dict):
             encoded_dict = {}
+    if isinstance(obj, bytes):
+        if bytes_encoding == "hex":
+            return obj.hex()
+        return base64.b64encode(obj).decode("ascii")
+    if isinstance(obj, memoryview):
+        bytes_data = obj.tobytes()
+        if bytes_encoding == "hex":
+            return bytes_data.hex()
+        return base64.b64encode(bytes_data).decode("ascii")
+    if isinstance(obj, Enum):
+        return obj.value
+    if dataclasses.is_dataclass(obj):
+        obj_dict = dataclasses.asdict(obj)
+        return jsonable_encoder(
+            obj_dict,
+            include=include,
+            exclude=exclude,
+            by_alias=by_alias,
+            exclude_unset=exclude_unset,
+            exclude_defaults=exclude_defaults,
+            exclude_none=exclude_none,
+            custom_encoder=custom_encoder,
+            sqlalchemy_safe=sqlalchemy_safe,
+            bytes_encoding=bytes_encoding,
+        )
+    if isinstance(obj, Enum):
+        return obj.value
+    if isinstance(obj, PurePath):
+        return str(obj)
+    if isinstance(obj, (UUID, AnyUrl, NameEmail)):
+        return str(obj)
+    if isinstance(obj, datetime.timedelta):
+        return obj.total_seconds()
+    if isinstance(obj, datetime.date):
+        return isoformat(obj)
+    if isinstance(obj, datetime.time):
+        return isoformat(obj)
+    if isinstance(obj, Pattern):
+        return obj.pattern
+    if isinstance(obj, Decimal):
+        return decimal_encoder(obj)
+    if isinstance(obj, (frozenset, set, deque, GeneratorType)):
+        return list(obj)
+    if isinstance(obj, (IPv4Address, IPv4Interface, IPv4Network, IPv6Address, IPv6Interface, IPv6Network)):
+        return str(obj)
+    if isinstance(obj, SecretStr):
+        return str(obj)
+    if isinstance(obj, SecretBytes):
+        return str(obj)
+    if isinstance(obj, (Url, AnyUrl)):
+        return str(obj)
+    if isinstance(obj, (Color, PyExtraColor)):
+        return str(obj)
+    if isinstance(obj, PydanticUndefinedType):
+        return None
+    if isinstance(obj, Exception):
+        return str(obj)
+    if isinstance(obj, type):
+        return obj.__name__
+    if isinstance(obj, (bytes, bytearray)):
+        return obj.decode(errors="replace")
+    if isinstance(obj, memoryview):
+        return obj.tobytes().decode(errors="replace")
+    if isinstance(obj, (set, frozenset)):
+        return sorted(list(obj))
+    if isinstance(obj, (list, set, frozenset, tuple, GeneratorType, deque)):
+        encoded_list = []
+        for item in obj:
+            encoded_list.append(
+                jsonable_encoder(
+                    item,
+                    include=include,
+                    exclude=exclude,
+                    by_alias=by_alias,
+                    exclude_unset=exclude_unset,
+                    exclude_defaults=exclude_defaults,
+                    exclude_none=exclude_none,
+                    custom_encoder=custom_encoder,
+                    sqlalchemy_safe=sqlalchemy_safe,
+                    bytes_encoding=bytes_encoding,
+                )
+            )
+        return encoded_list
+    if isinstance(obj, dict):
+        encoded_dict = {}
         for key, value in obj.items():
             encoded_key = jsonable_encoder(
                 key,
@@ -232,6 +253,7 @@
                 exclude_none=exclude_none,
                 custom_encoder=custom_encoder,
                 sqlalchemy_safe=sqlalchemy_safe,
+                bytes_encoding=bytes_encoding,
             )
             encoded_value = jsonable_encoder(
                 value,
@@ -243,6 +265,7 @@
                 exclude_none=exclude_none,
                 custom_encoder=custom_encoder,
                 sqlalchemy_safe=sqlalchemy_safe,
+                bytes_encoding=bytes_encoding,
             )
             encoded_dict[encoded_key] = encoded_value
         return encoded_dict
@@ -257,6 +280,7 @@
                 exclude_none=exclude_none,
                 custom_encoder=custom_encoder,
                 sqlalchemy_safe=sqlalchemy_safe,
+                bytes_encoding=bytes_encoding,
             )
             for item in obj
         ]
@@ -274,6 +298,7 @@
                 exclude_none=exclude_none,
                 custom_encoder=custom_encoder,
                 sqlalchemy_safe=sqlalchemy_safe,
+                bytes_encoding=bytes_encoding,
             )
         return encoded_list
 
@@ -290,6 +315,7 @@
                 exclude_none=exclude_none,
                 custom_encoder=custom_encoder,
                 sqlalchemy_safe=sqlalchemy_safe,
+                bytes_encoding=bytes_encoding,
             )
         return encoded_list
 
@@ -307,6 +333,7 @@
                 exclude_none=exclude_none,
                 custom_encoder=custom_encoder,
                 sqlalchemy_safe=sqlalchemy_safe,
+                bytes_encoding=bytes_encoding,
             )
         return encoded_list
 
@@ -326,6 +353,7 @@
                 exclude_none=exclude_none,
                 custom_encoder=custom_encoder,
                 sqlalchemy_safe=sqlalchemy_safe,
+                bytes_encoding=bytes_encoding,
             )
         return encoded_list
 
@@ -343,6 +371,7 @@
                 exclude_none=exclude_none,
                 custom_encoder=custom_encoder,
                 sqlalchemy_safe=sqlalchemy_safe,
+                bytes_encoding=bytes_encoding,
             )
         return encoded_list
 
@@ -360,6 +389,7 @@
                 exclude_none=exclude_none,
                 custom_encoder=custom_encoder,
                 sqlalchemy_safe=sqlalchemy_safe,
+                bytes_encoding=bytes_encoding,
             )
         return encoded_list
 
@@ -377,6 +407