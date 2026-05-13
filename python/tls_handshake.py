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
        HandshakeState.FINISHED,       # allows skipping key exchange
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
            raise ValueError("Record data is too short")

        content_type = data[0]
        version_major = data[1]
        version_minor = data[2]
        length = struct.unpack("!H", data[3:5])[0]

        if content_type != ContentType.HANDSHAKE.value:
            raise ValueError("Not a handshake message")

        if version_major != 3 or version_minor not in (1, 3):
            raise ValueError("Invalid TLS version")

        payload = data[5:5 + length]
        if len(payload) < 4:
            raise ValueError("Payload is too short")

        msg_type_val = payload[0]
        msg_length = struct.unpack("!I", b'\x00' + payload[1:4])[0]

        try:
            msg_type = HandshakeType(msg_type_val)
        except ValueError:
            raise ValueError("Invalid handshake message type")

        msg_payload = payload[4:4 + msg_length]
        self.transcript.extend(payload[:4 + msg_length])
        self.handshake_hash.update(payload[:4 + msg_length])

        message = HandshakeMessage(msg_type, msg_payload)
        return message

    def derive_keys(self) -> None:
        """Derive encryption keys from the master secret."""
        if not self.master_secret:
            raise ValueError("Master secret is not set")

        client_random = self.client_random or b'\x00' * 32
        server_random = self.server_random or b'\x00' * 32

        # Derive keys using the master secret and random values
        master_secret = self.master_secret
        key_block = hmac.new(master_secret, client_random + server_random, hashlib.sha1).digest()
        self.cipher_suite = struct.unpack("!I", key_block[:4])[0]

    def parse_client_hello(self, message: HandshakeMessage) -> bool:
        """Parse ClientHello message fields."""
        payload = message.payload
        if len(payload) < 38:
            raise ValueError("ClientHello payload is too short")

        offset = 0
        # client version
        client_version = struct.unpack("!H", payload[offset:offset + 2])[0]
        offset += 2

        # random
        random = payload[offset:offset + 32]
        self.client_random = random
        offset += 32

        # session id
        session_id_length = payload[offset]
        offset += 1
        session_id = payload[offset:offset + session_id_length]
        self.session_id = session_id
        offset += session_id_length

        # cipher suites
        cipher_suites_length = struct.unpack("!H", payload[offset:offset + 2])[0]
        offset += 2
        cipher_suites = struct.unpack(f"!{cipher_suites_length // 2}H", payload[offset:offset + cipher_suites_length])
        self.cipher_suite = cipher_suites[0]
        offset += cipher_suites_length

        # compression methods
        compression_methods_length = payload[offset]
        offset += 1
        compression_methods = payload[offset:offset + compression_methods_length]

        # extensions
        extensions_length = struct.unpack("!H", payload[offset:offset + 2])[0]
        offset += 2
        extensions = payload[offset:offset + extensions_length]

        # Parse extensions
        while extensions:
            ext_type, ext_length = struct.unpack("!HH", extensions[:4])
            ext_data = extensions[4:4 + ext_length]
            extensions = extensions[4 + ext_length:]

            extension = TLSExtension(ext_type, ext_data)
            self.extensions[ext_type] = extension

        return True

    def parse_server_hello(self, message: HandshakeMessage) -> bool:
        """Parse ServerHello message fields."""
        payload = message.payload
        if len(payload) < 38:
            raise ValueError("ServerHello payload is too short")

        offset = 0
        # server version
        server_version = struct.unpack("!H", payload[offset:offset + 2])[0]
        offset += 2

        # random
        random = payload[offset:offset + 32]
        self.server_random = random
        offset += 32

        # session id
        session_id_length = payload[offset]
        offset += 1
        session_id = payload[offset:offset + session_id_length]
        self.session_id = session_id
        offset += session_id_length

        # cipher suite
        cipher_suite = struct.unpack("!H", payload[offset:offset + 2])[0]
        self.cipher_suite = cipher_suite
        offset += 2

        # compression method
        compression_method = payload[offset]

        # extensions
        extensions_length = struct.unpack("!H", payload[offset + 1:offset + 3])[0]
        offset += 3
        extensions = payload[offset:offset + extensions_length]

        # Parse extensions
        while extensions:
            ext_type, ext_length = struct.unpack("!HH", extensions[:4])
            ext_data = extensions[4:4 + ext_length]
            extensions = extensions[4 + ext_length:]

            extension = TLSExtension(ext_type, ext_data)
            self.extensions[ext_type] = extension

        return True