"""
TLS handshake parsing module.

Implements parsing of TLS ClientHello messages, including extraction of SNI,
supported versions, signature algorithms, and extended master secret extension.
Supports Python 3.10+ with full type annotations and comprehensive error handling.
"""

import struct
import logging
from typing import Optional, Dict, List, Tuple, Any

# Extension type constants
EXT_SNI = 0x0000
EXT_EXTENDED_MASTER_SECRET = 0x0017
EXT_SIGNATURE_ALGORITHMS = 0x000D
EXT_SUPPORTED_VERSIONS = 0x002B

logger = logging.getLogger(__name__)


class TLSExtension:
    """Represents a single TLS extension parsed from the ClientHello."""

    def __init__(self, ext_type: int) -> None:
        """Initialize an extension with given type.

        Args:
            ext_type: The TLS extension type code (e.g., EXT_SNI).
        """
        self.ext_type: int = ext_type
        self.data: Optional[bytes] = None
        # SNI-specific field (RFC 6066)
        self.server_name: Optional[str] = None
        # Extended master secret flag
        self.extended_master_secret: bool = False
        # Signature algorithms (list of HashAlgorithm + SignatureAlgorithm pairs)
        self.signature_algorithms: Optional[List[Tuple[int, int]]] = None
        # Supported versions list
        self.supported_versions: Optional[List[int]] = None


class TLSHandshake:
    """Parses TLS ClientHello handshake message extensions."""

    def __init__(self) -> None:
        """Initialize empty handshake state."""
        self.extensions: Dict[int, TLSExtension] = {}
        self.server_name: Optional[str] = None

    def parse_extensions(self, data: bytes) -> None:
        """Parse the TLS extensions block from a ClientHello.

        Implements RFC 6066 SNI, RFC 7627 extended master secret,
        RFC 8446 supported versions, and RFC 5246 signature algorithms.

        Args:
            data: Raw bytes of the extensions block (without overall length prefix).

        Raises:
            ValueError: If the data is malformed or contains invalid encoding.
            struct.error: If unpacking fails due to insufficient data.
        """
        if not isinstance(data, bytes):
            raise TypeError(f"Expected bytes, got {type(data).__name__}")

        if not data:
            logger.debug("No extensions data provided.")
            return

        offset = 0
        data_len = len(data)

        while offset + 4 <= data_len:
            # Read extension type and length
            try:
                ext_type, ext_length = struct.unpack("!HH", data[offset:offset + 4])
            except struct.error as e:
                logger.error("Failed to unpack extension header at offset %d: %s", offset, e)
                raise
            offset += 4

            if offset + ext_length > data_len:
                logger.error(
                    "Extension type 0x%04x claims length %d but only %d bytes remain",
                    ext_type, ext_length, data_len - offset
                )
                raise ValueError(
                    f"Extension type 0x{ext_type:04x} length {ext_length} exceeds remaining data"
                )

            ext_data = data[offset:offset + ext_length]
            offset += ext_length

            # Create or fetch extension object
            try:
                ext = TLSExtension(ext_type)
                ext.data = ext_data
            except Exception as e:
                logger.warning("Failed to create extension object for type 0x%04x: %s", ext_type, e)
                ext = TLSExtension(ext_type)
                ext.data = ext_data

            # Parse known extension types
            try:
                self._parse_known_extension(ext, ext_data, ext_type)
            except (ValueError, struct.error, IndexError) as e:
                logger.warning(
                    "Failed to parse extension type 0x%04x: %s. Storing raw data.",
                    ext_type, e
                )
                # Keep extension with raw data but without parsed fields

            self.extensions[ext_type] = ext

        if offset != data_len:
            logger.warning("Extensions data had %d trailing bytes after parsing", data_len - offset)

    def _parse_known_extension(self, ext: TLSExtension, ext_data: bytes, ext_type: int) -> None:
        """Parse a single known extension type and populate the extension object.

        Args:
            ext: The TLSExtension object to populate.
            ext_data: Raw extension payload (excluding type and length header).
            ext_type: The TLS extension type code.

        Raises:
            ValueError: If extension data is malformed.
            struct.error: If unpacking fails.
        """
        if ext_type == EXT_SNI:
            self._parse_sni_extension(ext, ext_data)
        elif ext_type == EXT_EXTENDED_MASTER_SECRET:
            self._parse_extended_master_secret(ext, ext_data)
        elif ext_type == EXT_SIGNATURE_ALGORITHMS:
            self._parse_signature_algorithms(ext, ext_data)
        elif ext_type == EXT_SUPPORTED_VERSIONS:
            self._parse_supported_versions(ext, ext_data)
        else:
            # Unknown extension: keep raw data, no parsing
            logger.debug("Unrecognized extension type 0x%04x (length %d)", ext_type, len(ext_data))

    def _parse_sni_extension(self, ext: TLSExtension, ext_data: bytes) -> None:
        """Parse SNI extension (RFC 6066) and set server_name fields.

        Format:
          - 2 bytes: server name list length (uint16)
          - For each entry:
            - 1 byte: name type (0x00 = host_name)
            - 2 bytes: name length (uint16)
            - name bytes

        Only the first host_name entry (name_type == 0x00) is used.

        Args:
            ext: The TLSExtension object to populate.
            ext_data: The extension payload (without type and length header).

        Raises:
            ValueError: If the extension data is malformed or contains invalid encoding.
            struct.error: If unpacking fails due to insufficient data.
        """
        if len(ext_data) < 2:
            raise ValueError(f"SNI extension data too short: {len(ext_data)} bytes (need at least 2)")

        try:
            list_length = struct.unpack("!H", ext_data[0:2])[0]
        except struct.error as e:
            raise ValueError(f"Failed to unpack SNI list length: {e}") from e

        # Validate list length against available data
        if list_length + 2 > len(ext_data):
            raise ValueError(
                f"SNI server name list length {list_length} exceeds available data {len(ext_data) - 2}"
            )

        if list_length == 0:
            logger.debug("SNI extension present but empty server name list.")
            ext.server_name = None
            self.server_name = None
            return

        # Parse server name entries
        pos = 2
        end = 2 + list_length
        hostname_found = False

        while pos + 3 <= end:
            try:
                name_type = ext_data[pos]
                name_len = struct.unpack("!H", ext_data[pos + 1:pos + 3])[0]
            except struct.error as e:
                raise ValueError(f"Failed to unpack SNI entry header at offset {pos}: {e}") from e

            pos += 3

            if pos + name_len > end:
                raise ValueError(
                    f"SNI entry name length {name_len} exceeds remaining data at offset {pos}"
                )

            # Only process host_name type (0x00)
            if name_type == 0x00 and not hostname_found:
                try:
                    hostname_bytes = ext_data[pos:pos + name_len]
                    hostname = hostname_bytes.decode("ascii")
                except UnicodeDecodeError as e:
                    raise ValueError(f"SNI hostname contains non-ASCII characters: {e}") from e

                # Validate hostname per RFC 6066: ASCII, no null bytes
                if "\x00" in hostname:
                    raise ValueError("SNI hostname contains null bytes (security issue)")

                ext.server_name = hostname
                self.server_name = hostname
                hostname_found = True
                logger.debug("Parsed SNI hostname: %s", hostname)
            else:
                # Skip non-hostname entries or additional hostnames (RFC 6066 says only first is used)
                logger.debug(
                    "Skipping SNI entry type %d length %d (hostname already found: %s)",
                    name_type, name_len, hostname_found
                )

            pos += name_len

        # No hostname entry found
        if not hostname_found:
            ext.server_name = None
            self.server_name = None
            logger.debug("No host_name (type 0x00) entry found in SNI extension.")

    def _parse_extended_master_secret(self, ext: TLSExtension, ext_data: bytes) -> None:
        """Parse extended master secret extension (RFC 7627).

        This extension has no payload; its presence signals support.

        Args:
            ext: The TLSExtension object to populate.
            ext_data: Extension payload (should be empty).

        Raises:
            ValueError: If the extension data is not empty.
        """
        if ext_data:
            raise ValueError(
                f"Extended master secret extension has non-empty data ({len(ext_data)} bytes)"
            )
        ext.extended_master_secret = True
        logger.debug("Parsed extended master secret extension.")

    def _parse_signature_algorithms(self, ext: TLSExtension, ext_data: bytes) -> None:
        """Parse signature algorithms extension (RFC 5246 / RFC 8446).

        Format:
          - 2 bytes: supported_signature_algorithms length (uint16)
          - List of 2-byte HashAlgorithm + SignatureAlgorithm pairs

        Args:
            ext: The TLSExtension object to populate.
            ext_data: The extension payload.

        Raises:
            ValueError: If the data is malformed or length mismatch.
            struct.error: If unpacking fails.
        """
        if len(ext_data) < 2:
            raise ValueError(f"Signature algorithms extension too short: {len(ext_data)} bytes")

        try:
            alg_length = struct.unpack("!H", ext_data[0:2])[0]
        except struct.error as e:
            raise ValueError(f"Failed to unpack signature algorithms length: {e}") from e

        if alg_length + 2 != len(ext_data):
            raise ValueError(
                f"Signature algorithms length {alg_length} does not match data size {len(ext_data) - 2}"
            )

        if alg_length % 2 != 0:
            raise ValueError(f"Signature algorithms length {alg_length} is not a multiple of 2")

        algs: List[Tuple[int, int]] = []
        pos = 2
        while pos + 2 <= len(ext_data):
            try:
                hash_alg = ext_data[pos]
                sig_alg = ext_data[pos + 1]
            except IndexError as e:
                raise ValueError(f"Failed to read algorithm at offset {pos}: {e}") from e
            algs.append((hash_alg, sig_alg))
            pos += 2

        ext.signature_algorithms = algs
        logger.debug("Parsed %d signature algorithms.", len(algs))

    def _parse_supported_versions(self, ext: TLSExtension, ext_data: bytes) -> None:
        """Parse supported versions extension (RFC 8446).

        Format:
          - 1 byte: length of following version list (uint8)
          - List of 2-byte protocol version codes

        Args:
            ext: The TLSExtension object to populate.
            ext_data: The extension payload.

        Raises:
            ValueError: If the data is malformed or length mismatch.
            struct.error: If unpacking fails.
        """
        if not ext_data:
            raise ValueError("Supported versions extension is empty")

        try:
            length = ext_data[0]
        except IndexError as e:
            raise ValueError(f"Failed to read supported versions length: {e}") from e

        if length + 1 != len(ext_data):
            raise ValueError(
                f"Supported versions length {length} does not match data size {len(ext_data) - 1}"
            )

        if length % 2 != 0:
            raise ValueError(f"Supported versions length {length} is not a multiple of 2")

        versions: List[int] = []
        pos = 1
        while pos + 2 <= len(ext_data):
            try:
                version = struct.unpack("!H", ext_data[pos:pos + 2])[0]
            except struct.error as e:
                raise ValueError(f"Failed to unpack version at offset {pos}: {e}") from e
            versions.append(version)
            pos += 2

        ext.supported_versions = versions
        logger.debug("Parsed %d supported versions.", len(versions))

    def get_state_info(self) -> Dict[str, Any]:
        """Return a dictionary with parsed state information.

        Useful for logging and diagnostics.

        Returns:
            Dict containing:
                - server_name: SNI hostname or None
                - extensions: list of extension types and their parsed content
        """
        ext_info: Dict[int, Dict[str, Any]] = {}
        for ext_type, ext in self.extensions.items():
            info: Dict[str, Any] = {
                "extended_master_secret": ext.extended_master_secret,
                "server_name": ext.server_name,
                "signature_algorithms": ext.signature_algorithms,
                "supported_versions": ext.supported_versions,
            }
            ext_info[ext_type] = info

        return {
            "server_name": self.server_name,
            "extensions": ext_info,
        }