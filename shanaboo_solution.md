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
@@ -51,7 +52,6 @@
 
 
 ENCODERS_BY_TYPE: dict[type[Any], Callable[[Any], Any]] = {
-    bytes: lambda o: o.decode(),
     Color: str,
     PyExtraColor: str,
     datetime.date: isoformat,
@@ -97,6 +97,7 @@
     include: Annotated[
         IncEx | None,
         Doc(
+            """
             Pydantic's `include` parameter, passed to Pydantic models to set the
             fields to include.
             """
@@ -105,6 +106,7 @@
     exclude: Annotated[
         IncEx | None,
         Doc(
+            """
             Pydantic's `exclude` parameter, passed to Pydantic models to set the
             fields to exclude.
             """
@@ -113,6 +115,7 @@
     exclude_unset: Annotated[
         bool,
         Doc(
+            """
             Whether to exclude fields that have not been explicitly set.
             """
         ),
@@ -120,6 +123,7 @@
     exclude_defaults: Annotated[
         bool,
         Doc(
+            """
             Whether to exclude fields that have default values.
             """
         ),
@@ -127,6 +131,7 @@
     exclude_none: Annotated[
         bool,
         Doc(
+            """
             Whether to exclude fields that have a value of `None`.
             """
         ),
@@ -134,6 +139,7 @@
     custom_encoder: Annotated[
         dict[Any, Callable[[Any], Any]] | None,
         Doc(
+            """
             A custom encoder dictionary to use for specific types.
             """
         ),
@@ -141,6 +147,7 @@
     custom_serializer: Annotated[
         Callable[[Any], Any] | None,
         Doc(
+            """
             A custom serializer function to use for all objects.
             """
         ),
@@ -148,6 +155,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -155,6 +163,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -162,6 +171,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -169,6 +179,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -176,6 +187,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -183,6 +195,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -190,6 +203,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -197,6 +211,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -204,6 +219,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -211,6 +227,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -218,6 +235,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -225,6 +243,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -232,6 +251,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -239,6 +259,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -246,6 +267,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -253,6 +275,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -260,6 +283,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -267,6 +291,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -274,6 +299,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -281,6 +307,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -288,6 +315,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -295,6 +323,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -302,6 +331,7 @@
     by_alias: Annotated[
         bool,
         Doc(
+            """
             Whether to use the alias names for Pydantic models.
             """
         ),
@@ -309,6 +339,7 @@
     by_alias: Annotated[
