"""
TLS 1.2 Handshake Implementation — Security-Fixed Version
"""

import hashlib
import hmac
import struct
import os
from enum import Enum, auto
from typing import Optional, Dict, List, Tuple, Any


class HandshakeState(Enum):
    IDLE = auto()
    CLIENT_HELLO = auto()
    SERVER_HELLO = auto()
    CERTIFICATE = auto()
    KEY_EXCHANGE = auto()
    CHANGE_CIPHER_SPEC = auto()
    FINISHED = auto()
    ESTABLISHED = auto()
    ERROR = auto()


class ContentType(Enum):
    CHANGE_CIPHER_SPEC = 20
    ALERT = 21
    HANDSHAKE = 22
    APPLICATION_DATA = 23


class HandshakeType(Enum):
    CLIENT_HELLO = 1
    SERVER_HELLO = 2
    CERTIFICATE = 11
    SERVER_KEY_EXCHANGE = 12
    CERTIFICATE_REQUEST = 13
    SERVER_HELLO_DONE = 14
    CERTIFICATE_VERIFY = 15
    CLIENT_KEY_EXCHANGE = 16
    FINISHED = 20


# TLS extension type codes
EXT_SNI = 0x0000
EXT_EXTENDED_MASTER_SECRET = 0x0017
EXT_SIGNATURE_ALGORITHMS = 0x000D
EXT_SUPPORTED_VERSIONS = 0x002B
EXT_KEY_SHARE = 0x0033


VALID_TRANSITIONS: Dict[HandshakeState, List[HandshakeState]] = {
    HandshakeState.IDLE: [HandshakeState.CLIENT_HELLO],
    HandshakeState.CLIENT_HELLO: [
        HandshakeState.SERVER_HELLO,        # fixed: removed FINISHED transition
    ],
    HandshakeState.SERVER_HELLO: [HandshakeState.CERTIFICATE],
    HandshakeState.CERTIFICATE: [HandshakeState.KEY_EXCHANGE],
    HandshakeState.KEY_EXCHANGE: [HandshakeState.CHANGE_CIPHER_SPEC],
    HandshakeState.CHANGE_CIPHER_SPEC: [HandshakeState.FINISHED],
    HandshakeState.FINISHED: [HandshakeState.ESTABLISHED],
    HandshakeState.ESTABLISHED: [],
    HandshakeState.ERROR: [],
}


class TLSExtension:
    """Represents a parsed TLS extension."""

    def __init__(self, ext_type: int, data: bytes):
        self.ext_type = ext_type
        self.data = data


class HandshakeMessage:
    """Represents a parsed TLS handshake message."""

    def __init__(self, msg_type: HandshakeType, payload: bytes):
        self.msg_type = msg_type
        self.payload = payload
        self.random: Optional[bytes] = None
        self.session_id: Optional[bytes] = None
        self.extensions: List[TLSExtension] = []

    def __repr__(self) -> str:
        return (
            f"HandshakeMessage(type={self.msg_type.name}, "
            f"payload_len={len(self.payload)})"
        )


class TLSHandshake:
    """
    A minimal TLS 1.2 handshake state machine.

    Security fixes applied:
    1.  Enforce proper state transitions (no key-exchange bypass)
    2.  Properly parse SNI server_name from extension data
    3.  Use constant-time HMAC comparison to prevent timing attacks
    4.  Replace bare except with specific exception handling
    5.  Use correct RFC 7627 'extended master secret' label when EMS is negotiated
    """

    def __init__(self, is_server: bool = False):
        self.state: HandshakeState = HandshakeState.IDLE
        self.is_server = is_server
        self.client_random: Optional[bytes] = None
        self.server_random: Optional[bytes] = None
        self.master_secret: Optional[bytes] = None
        self.session_id: Optional[bytes] = None
        self.cipher_suite: Optional[int] = None
        self.extensions: Dict[int, TLSExtension] = {}
        self.handshake_hash = hashlib.sha256()
        self.negotiated_ems: bool = False
        self.server_name: Optional[str] = None
        self._pre_master_secret: Optional[bytes] = None
        self.transcript: bytearray = bytearray()

    def transition_to(self, new_state: HandshakeState) -> bool:
        """Attempt a state transition. Returns True if valid."""
        allowed = VALID_TRANSITIONS.get(self.state, [])
        if new_state in allowed:
            self.state = new_state
            return True
        self.state = HandshakeState.ERROR
        return False

    def parse_record(self, data: bytes) -> Optional[HandshakeMessage]:
        """Parse a TLS record layer and extract the handshake message."""
        if len(data) < 5:
            return None

        content_type = data[0]
        version_major = data[1]
        version_minor = data[2]
        length = struct.unpack("!H", data[3:5])[0]

        if content_type != ContentType.HANDSHAKE.value:
            return None

        if version_major != 3 or version_minor not in (1, 3):
            return None

        payload = data[5:5 + length]
        if len(payload) < 4:
            return None

        msg_type_val = payload[0]
        msg_length = struct.unpack("!I", b'\x00' + payload[1:4])[0]

        try:
            msg_type = HandshakeType(msg_type_val)
        except ValueError:
            return None

        msg_payload = payload[4:4 + msg_length]
        self.transcript.extend(payload[:4 + msg_length])
        self.handshake_hash.update(payload[:4 + msg_length])

        message = HandshakeMessage(msg_type, msg_payload)
        return message

    def parse_client_hello(self, message: HandshakeMessage) -> bool:
        """Parse ClientHello message fields."""
        payload = message.payload
        if len(payload) < 38:
            return False

        offset = 0
        # client version (2 bytes)
        offset += 2
        # client random (32 bytes)
        message.random = payload[offset:offset + 32]
        self.client_random = message.random
        offset += 32
        # session ID
        sid_len = payload[offset]
        offset += 1
        message.session_id = payload[offset:offset + sid_len]
        offset += sid_len
        # cipher suites
        cs_len = struct.unpack("!H", payload[offset:offset + 2])[0]
        offset += 2 + cs_len
        # compression methods
        comp_len = payload[offset]
        offset += 1 + comp_len

        # extensions
        if offset < len(payload):
            ext_len = struct.unpack("!H", payload[offset:offset + 2])[0]
            offset += 2
            ext_data = payload[offset:offset + ext_len]
            message.extensions = self.parse_extensions(ext_data)

        return True

    def _parse_sni_extension(self, data: bytes) -> Optional[str]:
        """Parse SNI (server_name) extension per RFC 6066, §3."""
        if len(data) < 5:
            return None
        # server name list length (2 bytes)
        offset = 2
        if offset + 3 > len(data):
            return None
        name_type = data[offset]
        offset += 1
        if name_type != 0:  # host_name
            return None
        name_len = struct.unpack("!H", data[offset:offset + 2])[0]
        offset += 2
        if offset + name_len > len(data):
            return None
        return data[offset:offset + name_len].decode("ascii", errors="replace")

    def parse_extensions(self, data: bytes) -> List[TLSExtension]:
        """Parse TLS extensions from raw bytes."""
        extensions = []
        offset = 0

        while offset + 4 <= len(data):
            ext_type = struct.unpack("!H", data[offset:offset + 2])[0]
            ext_len = struct.unpack("!H", data[offset + 2:offset + 4])[0]
            ext_data = data[offset + 4:offset + 4 + ext_len]
            offset += 4 + ext_len

            ext = TLSExtension(ext_type, ext_data)

            # Fix BUG 2: properly parse SNI server_name from extension data
            if ext_type == EXT_SNI:
                self.server_name = self._parse_sni_extension(ext_data)
            elif ext_type == EXT_EXTENDED_MASTER_SECRET:
                self.negotiated_ems = True
            elif ext_type == EXT_SIGNATURE_ALGORITHMS:
                pass  # stored in ext.data for later use
            elif ext_type == EXT_SUPPORTED_VERSIONS:
                pass  # stored in ext.data for later use

            self.extensions[ext_type] = ext
            extensions.append(ext)

        return extensions

    def verify_finished(self, received_verify: bytes, label: str) -> bool:
        """
        Verify the Finished message using HMAC-based PRF.
        Compares received verify_data against locally computed value.
        """
        if self.master_secret is None:
            return False

        transcript_hash = self.handshake_hash.copy().digest()
        computed_verify = self._prf(
            self.master_secret,
            label.encode("ascii"),
            transcript_hash,
            12,
        )

        # Fix BUG 3: use constant-time comparison to prevent timing side-channel
        return hmac.compare_digest(computed_verify, received_verify)

    def process_key_exchange(self, message: HandshakeMessage) -> bool:
        """Process a ClientKeyExchange or ServerKeyExchange message."""
        try:
            payload = message.payload
            if len(payload) < 2:
                raise ValueError("Key exchange payload too short")

            pms_len = struct.unpack("!H", payload[0:2])[0]
            if pms_len + 2 > len(payload):
                raise ValueError("Pre-master secret length mismatch")

            encrypted_pms = payload[2:2 + pms_len]
            self._pre_master_secret = self._decrypt_pre_master_secret(encrypted_pms)

            if self._pre_master_secret is None:
                raise ValueError("Failed to decrypt pre-master secret")

            self._derive_master_secret()
            return True

        # Fix BUG 4: specific exception handling instead of bare except
        except ValueError as e:
            raise e
        except Exception:
            # Any unexpected error should fail the handshake
            self.state = HandshakeState.ERROR
        return False

    def _derive_master_secret(self) -> None:
        """Derive the master secret from pre-master secret and randoms."""
        if self._pre_master_secret is None:
            raise ValueError("No pre-master secret available")
        if self.client_random is None or self.server_random is None:
            raise ValueError("Client/server random not set")

        seed = self.client_random + self.server_random

        # Fix BUG 5: use correct EMS label per RFC 7627 when negotiated
        if self.negotiated_ems:
            label = b"extended master secret"
        else:
            label = b"master secret"

        self.master_secret = self._prf(
            self._pre_master_secret, label, seed, 48
        )

    def _prf(self, secret: bytes, label: bytes, seed: bytes,
             output_len: int) -> bytes:
        """TLS 1.2 PRF using HMAC-SHA256 (P_SHA256)."""
        combined_seed = label + seed
        result = b""
        a_value = combined_seed  # A(0) = seed

        while len(result) < output_len:
            a_value = hmac.new(secret, a_value, hashlib.sha256).digest()
            block = hmac.new(
                secret, a_value + combined_seed, hashlib.sha256
            ).digest()
            result += block

        return result[:output_len]

    def _decrypt_pre_master_secret(self, encrypted: bytes) -> Optional[bytes]:
        """
        Placeholder for RSA decryption of the pre-master secret.
        In production, this would use the server's private key.
        """
        # Stub: return a deterministic value for testing
        if len(encrypted) < 48:
            return None
        return encrypted[:48]

    def process_message(self, data: bytes) -> Tuple[bool, str]:
        """
        Main entry point: parse a TLS record and advance the state machine.
        Returns (success, status_message).
        """
        message = self.parse_record(data)
        if message is None:
            return False, "Failed to parse TLS record"

        if message.msg_type == HandshakeType.CLIENT_HELLO:
            if not self.transition_to(HandshakeState.CLIENT_HELLO):
                return False, "Invalid state for ClientHello"
            if not self.parse_client_hello(message):
                return False, "Malformed ClientHello"
            return True, "ClientHello processed"

        elif message.msg_type == HandshakeType.SERVER_HELLO:
            if not self.transition_to(HandshakeState.SERVER_HELLO):
                return False, "Invalid state for ServerHello"
            return True, "ServerHello processed"

        elif message.msg_type == HandshakeType.CERTIFICATE:
            if not self.transition_to(HandshakeState.CERTIFICATE):
                return False, "Invalid state for Certificate"
            return True, "Certificate processed"

        elif message.msg_type in (
            HandshakeType.CLIENT_KEY_EXCHANGE,
            HandshakeType.SERVER_KEY_EXCHANGE,
        ):
            if not self.transition_to(HandshakeState.KEY_EXCHANGE):
                return False, "Invalid state for KeyExchange"
            success = self.process_key_exchange(message)
            if not success:
                return False, "Key exchange failed"
            return True, "Key exchange processed"

        elif message.msg_type == HandshakeType.FINISHED:
            if not self.transition_to(HandshakeState.FINISHED):
                return False, "Invalid state for Finished"
            label = (
                "server finished" if self.is_server else "client finished"
            )
            if not self.verify_finished(message.payload, label):
                return False, "Finished verification failed"
            return True, "Handshake finished"

        return False, f"Unhandled message type: {message.msg_type}"

    def get_state_info(self) -> Dict[str, Any]:
        """Return current handshake state for diagnostics."""
        return {
            "state": self.state.name,
            "cipher_suite": self.cipher_suite,
            "session_id": self.session_id.hex() if self.session_id else None,
            "server_name": self.server_name,
            "ems_negotiated": self.negotiated_ems,
            "extensions": list(self.extensions.keys()),
            "has_master_secret": self.master_secret is not None,
        }
