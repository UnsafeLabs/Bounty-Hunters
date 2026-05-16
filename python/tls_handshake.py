"""
TLS ClientHello handshake parser with full SNI support (RFC 6066).

Provides classes for parsing TLS extensions and the ClientHello handshake message,
with robust error handling, type safety, and detailed logging.
"""

import logging
import struct
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# TLS Extension type constants
EXT_SNI: int = 0x0000
EXT_EXTENDED_MASTER_SECRET: int = 0x0017
EXT_SIGNATURE_ALGORITHMS: int = 0x000d
EXT_SUPPORTED_VERSIONS: int = 0x002b

# Maximum allowed SNI hostname length (RFC 1035 suggests 253 bytes)
_MAX_SNI_HOSTNAME_LEN: int = 253


class TLSExtension:
    """Represents a single TLS extension with optional parsed fields."""

    def __init__(self, ext_type: int, data: bytes) -> None:
        """
        Initialize a TLS extension.

        Args:
            ext_type: The extension type code (e.g., 0x0000 for SNI).
            data: Raw extension body bytes.

        Raises:
            TypeError: If ext_type is not int or data is not bytes.
        """
        if not isinstance(ext_type, int) or not isinstance(data, bytes):
            raise TypeError("ext_type must be int, data must be bytes")
        self.ext_type: int = ext_type
        self.data: bytes = data
        self.server_name: Optional[str] = None

    def __repr__(self) -> str:
        return f"TLSExtension(type=0x{self.ext_type:04x}, len={len(self.data)})"


class TLSHandshake:
    """
    Parses a TLS ClientHello message and extracts handshake parameters,
    including SNI (Server Name Indication) per RFC 6066.
    """

    def __init__(self, raw: bytes) -> None:
        """
        Initialize the TLS handshake parser.

        Args:
            raw: Complete TLS handshake record containing a ClientHello.

        Raises:
            ValueError: If the record is malformed or not a ClientHello.
            TypeError: If raw is not bytes.
        """
        if not isinstance(raw, bytes):
            raise TypeError("raw must be bytes")
        self.raw: bytes = raw
        self.client_version: Optional[Tuple[int, int]] = None
        self.session_id: Optional[bytes] = None
        self.cipher_suites: List[int] = []
        self.compression_methods: List[int] = []
        self.extensions: Dict[int, TLSExtension] = {}
        self.server_name: Optional[str] = None
        self._parse()

    def _parse(self) -> None:
        """Parse the raw ClientHello message and populate all fields."""
        try:
            if len(self.raw) < 1:
                raise ValueError("Empty handshake data")

            offset = 0

            # Handshake type (1 byte)
            handshake_type = self.raw[offset]
            offset += 1
            if handshake_type != 0x01:
                raise ValueError(f"Not a ClientHello (type=0x{handshake_type:02x})")

            # Handshake message length (3 bytes, big-endian)
            if offset + 3 > len(self.raw):
                raise ValueError("Truncated handshake length")
            handshake_len = struct.unpack("!I", b'\x00' + self.raw[offset:offset + 3])[0]
            offset += 3
            if offset + handshake_len > len(self.raw):
                raise ValueError("Handshake length exceeds available data")

            data = self.raw[offset:offset + handshake_len]
            inner_offset = 0

            # Client version (2 bytes)
            if inner_offset + 2 > len(data):
                raise ValueError("Truncated client version")
            major, minor = struct.unpack("!BB", data[inner_offset:inner_offset + 2])
            self.client_version = (major, minor)
            inner_offset += 2

            # Random (32 bytes) – skip
            if inner_offset + 32 > len(data):
                raise ValueError("Truncated random")
            inner_offset += 32

            # Session ID (1 byte length, then content)
            if inner_offset + 1 > len(data):
                raise ValueError("Truncated session ID length")
            sid_len = data[inner_offset]
            inner_offset += 1
            if sid_len > 0:
                if inner_offset + sid_len > len(data):
                    raise ValueError("Truncated session ID")
                self.session_id = data[inner_offset:inner_offset + sid_len]
                inner_offset += sid_len
            else:
                self.session_id = b''

            # Cipher suites (2 bytes length, then 2‑byte each)
            if inner_offset + 2 > len(data):
                raise ValueError("Truncated cipher suite length")
            cs_len = struct.unpack("!H", data[inner_offset:inner_offset + 2])[0]
            inner_offset += 2
            if cs_len % 2 != 0:
                raise ValueError("Cipher suite length is not a multiple of 2")
            if inner_offset + cs_len > len(data):
                raise ValueError("Truncated cipher suites")
            cipher_bytes = data[inner_offset:inner_offset + cs_len]
            # Unpack as big‑endian unsigned shorts
            self.cipher_suites = list(
                struct.unpack(f"!{cs_len // 2}H", cipher_bytes)
            )
            inner_offset += cs_len

            # Compression methods (1 byte length, then 1‑byte each)
            if inner_offset + 1 > len(data):
                raise ValueError("Truncated compression methods length")
            cm_len = data[inner_offset]
            inner_offset += 1
            if cm_len > 0:
                if inner_offset + cm_len > len(data):
                    raise ValueError("Truncated compression methods")
                self.compression_methods = list(data[inner_offset:inner_offset + cm_len])
                inner_offset += cm_len
            else:
                self.compression_methods = []

            # Extensions (2 bytes total length, optional)
            if inner_offset + 2 > len(data):
                # No extensions present – valid
                logger.debug("No extensions in ClientHello")
                return
            ext_total_len = struct.unpack("!H", data[inner_offset:inner_offset + 2])[0]
            inner_offset += 2
            if ext_total_len == 0:
                return
            if inner_offset + ext_total_len > len(data):
                raise ValueError("Extensions length exceeds remaining data")
            ext_data = data[inner_offset:inner_offset + ext_total_len]
            self._parse_extensions(ext_data)

        except Exception as exc:
            logger.error("Failed to parse handshake: %s", exc)
            raise

    def _parse_extensions(self, data: bytes) -> None:
        """
        Parse TLS extensions from raw extension data.

        Args:
            data: Raw bytes containing all extensions (without total length).
        """
        if not data:
            return

        offset = 0
        while offset < len(data):
            # Minimum header: 2 bytes type + 2 bytes length
            if offset + 4 > len(data):
                logger.warning("Truncated extension header at offset %d", offset)
                break

            ext_type = struct.unpack("!H", data[offset:offset + 2])[0]
            ext_len = struct.unpack("!H", data[offset + 2:offset + 4])[0]
            offset += 4
            if offset + ext_len > len(data):
                logger.warning(
                    "Extension body for type 0x%04x exceeds available data", ext_type
                )
                break

            ext_body = data[offset:offset + ext_len]
            offset += ext_len

            # Create extension object (always store raw data)
            ext = TLSExtension(ext_type=ext_type, data=ext_body)
            self.extensions[ext_type] = ext

            # Parse known extension types
            if ext_type == EXT_SNI:
                self._parse_sni_extension(ext, ext_body)
            elif ext_type == EXT_EXTENDED_MASTER_SECRET:
                # Expected to be empty (length 0)
                if ext_body:
                    logger.debug("Extended Master Secret extension non-empty: %d bytes", len(ext_body))
            elif ext_type == EXT_SIGNATURE_ALGORITHMS:
                self._parse_signature_algorithms_extension(ext, ext_body)
            elif ext_type == EXT_SUPPORTED_VERSIONS:
                self._parse_supported_versions_extension(ext, ext_body)
            else:
                logger.debug("Unhandled extension type 0x%04x (%d bytes)", ext_type, ext_len)

    def _parse_sni_extension(self, ext: TLSExtension, body: bytes) -> None:
        """
        Parse the Server Name Indication (SNI) extension per RFC 6066.

        Args:
            ext: The TLSExtension object to update.
            body: Raw extension body (after type and length fields).

        Raises:
            ValueError: If the extension data is malformed.
        """
        try:
            if len(body) < 3:
                logger.warning("SNI extension too short: %d bytes", len(body))
                return

            # Skip server name list length (2 bytes)
            list_len = struct.unpack("!H", body[0:2])[0]
            if list_len + 2 > len(body):
                logger.warning("SNI list length exceeds extension body")
                return

            offset = 2
            end_limit = offset + list_len

            # Parse at most one host_name entry (RFC 6066 allows multiple, but typical use is one)
            while offset < end_limit:
                if offset + 1 > len(body):
                    logger.warning("Truncated SNI name type")
                    break

                name_type = body[offset]
                offset += 1

                if name_type != 0x00:
                    # Skip unknown name types (host_name is 0x00)
                    if offset + 2 > len(body):
                        break
                    name_len = struct.unpack("!H", body[offset:offset + 2])[0]
                    offset += 2 + name_len
                    continue

                # Host_name type (0x00)
                if offset + 2 > len(body):
                    logger.warning("Truncated SNI host_name length")
                    break
                name_len = struct.unpack("!H", body[offset:offset + 2])[0]
                offset += 2

                if name_len == 0:
                    logger.warning("Empty SNI host_name")
                    continue

                if offset + name_len > len(body):
                    logger.warning("SNI host_name length exceeds extension body")
                    break

                hostname_bytes = body[offset:offset + name_len]
                offset += name_len

                # Validate hostname (ASCII, printable, no null bytes)
                try:
                    hostname = hostname_bytes.decode("ascii")
                except UnicodeDecodeError:
                    logger.warning("SNI hostname is not valid ASCII")
                    continue

                if len(hostname) > _MAX_SNI_HOSTNAME_LEN:
                    logger.warning("SNI hostname exceeds maximum length (%d)", _MAX_SNI_HOSTNAME_LEN)
                    continue

                if not hostname or hostname[0] == '.' or hostname.endswith('.'):
                    logger.warning("SNI hostname invalid: %r", hostname)
                    continue

                # Sanity check: no dots-only, no spaces
                if any(c in hostname for c in (' ', '\t', '\n', '\r', '\0')):
                    logger.warning("SNI hostname contains whitespace or null")
                    continue

                # Valid hostname found – store it
                ext.server_name = hostname
                self.server_name = hostname
                logger.debug("Extracted SNI hostname: %s", hostname)
                return  # Only use the first valid host_name

            # If loop completes without finding a valid host_name
            logger.debug("No valid SNI host_name found in extension")

        except Exception as exc:
            logger.error("Failed to parse SNI extension: %s", exc)
            # Don't re-raise – treat as best-effort parse

    def _parse_signature_algorithms_extension(self, ext: TLSExtension, body: bytes) -> None:
        """
        Parse the Signature Algorithms extension (optional, placeholder).

        Args:
            ext: The TLSExtension object.
            body: Raw extension body.
        """
        # Minimal validation – actual parsing not required for this task
        if len(body) < 2:
            logger.warning("SignatureAlgorithms extension too short")
            return
        # Could store parsed list if needed
        logger.debug("Parsed SignatureAlgorithms extension (%d bytes)", len(body))

    def _parse_supported_versions_extension(self, ext: TLSExtension, body: bytes) -> None:
        """
        Parse the Supported Versions extension (optional, placeholder).

        Args:
            ext: The TLSExtension object.
            body: Raw extension body.
        """
        if len(body) < 1:
            logger.warning("SupportedVersions extension too short")
            return
        # Could store parsed versions
        logger.debug("Parsed SupportedVersions extension (%d bytes)", len(body))

    def get_state_info(self) -> Dict[str, object]:
        """
        Return a dictionary of the parsed handshake state for external use.

        Returns:
            Dict with keys: client_version, session_id, cipher_suites,
            compression_methods, extensions, server_name.
        """
        return {
            "client_version": self.client_version,
            "session_id": self.session_id,
            "cipher_suites": self.cipher_suites,
            "compression_methods": self.compression_methods,
            "extensions": {
                hex(k): {"type": hex(v.ext_type), "len": len(v.data), "server_name": v.server_name}
                for k, v in self.extensions.items()
            },
            "server_name": self.server_name,
        }