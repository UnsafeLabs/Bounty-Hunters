"""
tls_handshake.py

TLS handshake processing utilities. Provides key exchange validation
with structured exception handling and logging.
"""

import struct
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Structure format for key exchange header (2-byte length field)
_KEY_EXCHANGE_FORMAT = "!H"
_KEY_EXCHANGE_HEADER_SIZE = struct.calcsize(_KEY_EXCHANGE_FORMAT)


def process_key_exchange(payload: Optional[bytes] = None) -> bool:
    """
    Validate and process a TLS key exchange payload.

    Args:
        payload: Raw bytes of the key exchange message, or None.

    Returns:
        True if the payload is well-formed and accepted, False otherwise.
    """
    if payload is None:
        logger.warning("Received None payload in process_key_exchange")
        return False

    try:
        # Minimum payload length must include at least the header size
        if len(payload) < _KEY_EXCHANGE_HEADER_SIZE:
            logger.error(
                "Key exchange payload too short: %d bytes (minimum %d)",
                len(payload),
                _KEY_EXCHANGE_HEADER_SIZE,
            )
            return False

        # Unpack the length field from the header (big-endian unsigned short)
        (length,) = struct.unpack(_KEY_EXCHANGE_FORMAT, payload[:_KEY_EXCHANGE_HEADER_SIZE])

        # Verify that the declared length matches the remaining bytes
        if len(payload) - _KEY_EXCHANGE_HEADER_SIZE != length:
            logger.error(
                "Key exchange payload length mismatch: header field=%d, available=%d",
                length,
                len(payload) - _KEY_EXCHANGE_HEADER_SIZE,
            )
            return False

        # Additional validation could be added here (e.g., certificate parsing)
        logger.info("Key exchange payload accepted (length=%d)", length)
        return True

    except (ValueError, struct.error):
        return False