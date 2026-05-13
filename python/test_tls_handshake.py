import hashlib
import hmac
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tls_handshake import (
    EXT_EXTENDED_MASTER_SECRET,
    EXT_SIGNATURE_ALGORITHMS,
    ContentType,
    HandshakeState,
    HandshakeType,
    TLSHandshake,
)


def _handshake_record(message_type, payload, version=(3, 3)):
    handshake = bytes([message_type.value]) + len(payload).to_bytes(3, "big") + payload
    return (
        bytes([ContentType.HANDSHAKE.value, version[0], version[1]])
        + struct.pack("!H", len(handshake))
        + handshake
    )


def _client_hello_payload(extensions=b""):
    random = bytes(range(32))
    payload = b"\x03\x03" + random
    payload += b"\x00"
    payload += struct.pack("!H", 2) + b"\x13\x01"
    payload += b"\x01\x00"
    payload += struct.pack("!H", len(extensions)) + extensions
    return payload


def _extension(ext_type, data=b""):
    return struct.pack("!HH", ext_type, len(data)) + data


def test_valid_transition_updates_state():
    handshake = TLSHandshake()

    assert handshake.transition_to(HandshakeState.CLIENT_HELLO) is True
    assert handshake.state is HandshakeState.CLIENT_HELLO


def test_invalid_transition_sets_error_state():
    handshake = TLSHandshake()

    assert handshake.transition_to(HandshakeState.FINISHED) is False
    assert handshake.state is HandshakeState.ERROR


def test_parse_record_rejects_short_tls_record():
    handshake = TLSHandshake()

    assert handshake.parse_record(b"\x16\x03") is None


def test_parse_record_extracts_handshake_message_and_updates_transcript():
    handshake = TLSHandshake()
    payload = _client_hello_payload()
    record = _handshake_record(HandshakeType.CLIENT_HELLO, payload)

    message = handshake.parse_record(record)

    assert message is not None
    assert message.msg_type is HandshakeType.CLIENT_HELLO
    assert message.payload == payload
    assert bytes(handshake.transcript).startswith(bytes([HandshakeType.CLIENT_HELLO.value]))


def test_parse_client_hello_stores_random_session_and_extensions():
    handshake = TLSHandshake()
    extensions = _extension(EXT_EXTENDED_MASTER_SECRET)
    message = handshake.parse_record(
        _handshake_record(HandshakeType.CLIENT_HELLO, _client_hello_payload(extensions)),
    )

    assert message is not None
    assert handshake.parse_client_hello(message) is True
    assert handshake.client_random == bytes(range(32))
    assert message.session_id == b""
    assert handshake.negotiated_ems is True


def test_parse_extensions_records_known_and_unknown_extensions():
    handshake = TLSHandshake()
    raw_extensions = (
        _extension(EXT_SIGNATURE_ALGORITHMS, b"\x00\x02\x04\x03")
        + _extension(0x1234, b"data")
    )

    extensions = handshake.parse_extensions(raw_extensions)

    assert [ext.ext_type for ext in extensions] == [EXT_SIGNATURE_ALGORITHMS, 0x1234]
    assert handshake.extensions[0x1234].data == b"data"


def test_verify_finished_returns_false_without_master_secret():
    handshake = TLSHandshake()

    assert handshake.verify_finished(b"verify-data", "client finished") is False


def test_prf_is_deterministic_and_respects_output_length():
    handshake = TLSHandshake()

    first = handshake._prf(b"secret", b"label", b"seed", 48)
    second = handshake._prf(b"secret", b"label", b"seed", 48)

    assert first == second
    assert len(first) == 48


def test_process_key_exchange_rejects_short_payload():
    handshake = TLSHandshake()
    message = handshake.parse_record(
        _handshake_record(HandshakeType.CLIENT_KEY_EXCHANGE, b"\x00"),
    )

    assert message is not None
    assert handshake.process_key_exchange(message) is False


def test_verify_finished_accepts_matching_prf_output():
    handshake = TLSHandshake()
    handshake.master_secret = b"m" * 48
    handshake.handshake_hash.update(b"transcript")
    transcript_hash = hashlib.sha256(b"transcript").digest()
    expected = _tls_prf(handshake.master_secret, b"client finished", transcript_hash, 12)

    assert handshake.verify_finished(expected, "client finished") is True


def _tls_prf(secret, label, seed, output_len):
    combined_seed = label + seed
    result = b""
    a_value = combined_seed
    while len(result) < output_len:
        a_value = hmac.new(secret, a_value, hashlib.sha256).digest()
        result += hmac.new(secret, a_value + combined_seed, hashlib.sha256).digest()
    return result[:output_len]
