import logging

from fastapi.middleware.request_id import RequestIDLogFilter

logger = logging.getLogger("fastapi")
logger.addFilter(RequestIDLogFilter())

# Recommended log format that includes the request ID.
# Operators can set this on the root logger or per-handler:
#
#   handler.setFormatter(logging.Formatter(
#       "%(asctime)s [%(request_id)s] %(levelname)s %(name)s: %(message)s"
#   ))