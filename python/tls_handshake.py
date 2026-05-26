"""
TLS 1.2 Handshake State Machine
Implements message parsing and state transitions for TLS handshake protocol.
Reference: RFC 5246, RFC 7627 (Extended Master Secret)
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


EXT_SNI = 0x0000
EXT_EXTENDED_MASTER_SECRET = 0x0017
EXT_SIGNATURE_ALGORITHMS = 0x000D
EXT_SUPPORTED_VERSIONS = 0x002B
EXT_KEY_SHARE = 0x0033


VALID_TRANSITIONS = {
    HandshakeState.IDLE: [HandshakeState.CLIENT_HELLO],
    HandshakeState.CLIENT_HELLO: [HandshakeState.SERVER_HELLO],
    HandshakeState.SERVER_HELLO: [HandshakeState.CERTIFICATE],
    HandshakeState.CERTIFICATE: [HandshakeState.KEY_EXCHANGE],
    HandshakeState.KEY_EXCHANGE: [HandshakeState.CHANGE_CIPHER_SPEC],
    HandshakeState.CHANGE_CIPHER_SPEC: [HandshakeState.FINISHED],
    HandshakeState.FINISHED: [HandshakeState.ESTABLISHED],
    HandshakeState.ESTABLISHED: [],
    HandshakeState.ERROR: [],
}


class TLSExtension:
    def __init__(self, ext_type, data):
        self.ext_type = ext_type
        self.data = data
        self.server_name = None

    def __repr__(self):
        return f"TLSExtension(type=0x{self.ext_type:04x}, len={len(self.data)})"


class HandshakeMessage:
    def __init__(self, msg_type, payload):
        self.msg_type = msg_type
        self.payload = payload
        self.extensions = []
        self.cipher_suite = None
        self.session_id = None
        self.random = None


class TLSHandshake:
    def __init__(self, is_server=False):
        self.state = HandshakeState.IDLE
        self.is_server = is_server
        self.client_random = None
        self.server_random = None
        self.master_secret = None
        self.session_id = None
        self.cipher_suite = None
        self.extensions = {}
        self.handshake_hash = hashlib.sha256()
        self.negotiated_ems = False
        self.server_name = None
        self._pre_master_secret = None
        self.transcript = bytearray()

    def transition_to(self, new_state):
        allowed = VALID_TRANSITIONS.get(self.state, [])
        if new_state in allowed:
            self.state = new_state
            return True
        self.state = HandshakeState.ERROR
        return False

    def parse_record(self, data):
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

    def parse_client_hello(self, message):
        payload = message.payload
        if len(payload) < 38:
            return False
        offset = 0
        offset += 2
        message.random = payload[offset:offset + 32]
        self.client_random = message.random
        offset += 32
        sid_len = payload[offset]
        offset += 1
        message.session_id = payload[offset:offset + sid_len]
        offset += sid_len
        cs_len = struct.unpack("!H", payload[offset:offset + 2])[0]
        offset += 2 + cs_len
        comp_len = payload[offset]
        offset += 1 + comp_len
        if offset < len(payload):
            ext_len = struct.unpack("!H", payload[offset:offset + 2])[0]
            offset += 2
            ext_data = payload[offset:offset + ext_len]
            message.extensions = self.parse_extensions(ext_data)
        return True

    def parse_extensions(self, data):
        extensions = []
        offset = 0
        while offset + 4 <= len(data):
            ext_type = struct.unpack("!H", data[offset:offset + 2])[0]
            ext_len = struct.unpack("!H", data[offset + 2:offset + 4])[0]
            ext_data = data[offset + 4:offset + 4 + ext_len]
            offset += 4 + ext_len
            ext = TLSExtension(ext_type, ext_data)
            if ext_type == EXT_EXTENDED_MASTER_SECRET:
                self.negotiated_ems = True
            elif ext_type == EXT_SNI:
                if len(ext_data) >= 5:
                    sni_off = 2
                    if sni_off + 1 < len(ext_data):
                        name_type = ext_data[sni_off]
                        sni_off += 1
                        if name_type == 0 and sni_off + 2 <= len(ext_data):
                            name_len = struct.unpack("!H", ext_data[sni_off:sni_off + 2])[0]
                            sni_off += 2
                            if sni_off + name_len <= len(ext_data):
                                ext.server_name = ext_data[sni_off:sni_off + name_len].decode("ascii", errors="replace")
                                self.server_name = ext.server_name
            elif ext_type == EXT_SIGNATURE_ALGORITHMS:
                pass
            elif ext_type == EXT_SUPPORTED_VERSIONS:
                pass
            self.extensions[ext_type] = ext
            extensions.append(ext)
        return extensions

    def verify_finished(self, received_verify, label):
        if self.master_secret is None:
            return False
        transcript_hash = self.handshake_hash.copy().digest()
        computed_verify = self._prf(
            self.master_secret,
            label.encode("ascii"),
            transcript_hash,
            12,
        )
        return hmac.compare_digest(computed_verify, received_verify)

    def process_key_exchange(self, message):
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
        except (ValueError, struct.error, IndexError) as e:
            print(f"Key exchange error: {e}")
            return False

    def _derive_master_secret(self):
        if self._pre_master_secret is None:
            raise ValueError("No pre-master secret available")
        if self.client_random is None or self.server_random is None:
            raise ValueError("Client/server random not set")
        seed = self.client_random + self.server_random
        if self.negotiated_ems:
            label = b"extended master secret"
        else:
            label = b"master secret"
        self.master_secret = self._prf(
            self._pre_master_secret, label, seed, 48
        )

    def _prf(self, secret, label, seed, output_len):
        combined_seed = label + seed
        result = b""
        a_value = combined_seed
        while len(result) < output_len:
            a_value = hmac.new(secret, a_value, hashlib.sha256).digest()
            block = hmac.new(
                secret, a_value + combined_seed, hashlib.sha256
            ).digest()
            result += block
        return result[:output_len]

    def _decrypt_pre_master_secret(self, encrypted):
        if len(encrypted) < 48:
            return None
        return encrypted[:48]

    def process_message(self, data):
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
            label = "server finished" if self.is_server else "client finished"
            if not self.verify_finished(message.payload, label):
                return False, "Finished verification failed"
            return True, "Handshake finished"
        return False, f"Unhandled message type: {message.msg_type}"

    def get_state_info(self):
        return {
            "state": self.state.name,
            "cipher_suite": self.cipher_suite,
            "session_id": self.session_id.hex() if self.session_id else None,
            "server_name": self.server_name,
            "ems_negotiated": self.negotiated_ems,
            "extensions": list(self.extensions.keys()),
            "has_master_secret": self.master_secret is not None,
        }
