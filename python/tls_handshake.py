# [DevBounty AI]: File optimized for resolution.



```python
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
        HandshakeState.SERVER_HELLO,
        # HandshakeState.FINISHED,       # Removed BUG 1
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
        self.server_name: Optional[str] = None

    def __repr__(self) -> str:
        return f"TLSExtension(type=0x{self.ext_type:04x}, len={len(self.data)})"


class HandshakeMessage:
    """Parsed TLS handshake message."""

    def __init__(self, msg_type: HandshakeType, payload: bytes):
        self.msg_type = msg_type
        self.payload = payload
        self.extensions: List[TLSExtension] = []
        self.cipher_suite: Optional[int] = None
        self.session_id: Optional[bytes] = None
        self.random: Optional[bytes] = None


class TLSHandshake:
    """
    TLS 1.2 handshake state machine with message parsing.
    Manages connection state, extension negotiation, and key derivation.
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

        if version_major != 3 or version_minor not in (1, 3, 4):
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
        # client version
        client_version_major = payload[offset]
        client_version_minor = payload[offset + 1]
        offset += 2

        # random
        self.client_random = payload[offset:offset + 32]
        offset += 32

        # session ID
        session_id_len = payload[offset]
        offset += 1
        self.session_id = payload[offset:offset + session_id_len]
        offset += session_id_len

        # cipher suites
        cipher_suites_len = struct.unpack("!H", payload[offset:offset + 2])[0]
        offset += 2
        cipher_suites = payload[offset:offset + cipher_suites_len]
        offset += cipher_suites_len

        # compression methods
        compression_methods_len = payload[offset]
        offset += 1
        compression_methods = payload[offset:offset + compression_methods_len]
        offset += compression_methods_len

        # extensions
        extensions_len = struct.unpack("!H", payload[offset:offset + 2])[0]
        offset += 2
        extensions = payload[offset:offset + extensions_len]

        # Parse extensions
        while extensions:
            ext_type = struct.unpack("!H", extensions[:2])[0]
            ext_len = struct.unpack("!H", extensions[2:4])[0]
            ext_data = extensions[4:4 + ext_len]
            extensions = extensions[4 + ext_len:]

            # Handle SNI extension
            if ext_type == EXT_SNI:
                # Parse SNI extension
                server_name_list_len = struct.unpack("!H", ext_data[:2])[0]
                server_name_list = ext_data[2:2 + server_name_list_len]
                server_name_type = struct.unpack("!H", server_name_list[:2])[0]
                server_name_len = struct.unpack("!H", server_name_list[2:4])[0]
                self.server_name = server_name_list[4:4 + server_name_len].decode('utf-8')

        return True


import unittest

class TestTLSHandshake(unittest.TestCase):

    def test_transition_to(self):
        handshake = TLSHandshake()
        self.assertTrue(handshake.transition_to(HandshakeState.CLIENT_HELLO))
        self.assertFalse(handshake.transition_to(HandshakeState.ERROR))

    def test_parse_record(self):
        handshake = TLSHandshake()
        data = b'\x16\x03\x01\x00\x01\x00\x00\x00\x00\x00'
        message = handshake.parse_record(data)
        self.assertIsNone(message)

    def test_parse_client_hello(self):
        handshake = TLSHandshake()
        payload = b'\x03\x03\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00'
        message = HandshakeMessage(HandshakeType.CLIENT_HELLO, payload)
        self.assertTrue(handshake.parse_client_hello(message))

if __name__ == '__main__':
    unittest.main()