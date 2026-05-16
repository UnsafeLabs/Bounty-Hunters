"""
TLS 1.3 handshake state machine implementation with strict transition validation.

Provides a stateful TLS handshake manager that enforces valid state transitions
and includes comprehensive error handling, logging, and type safety.

Example:
    >>> handshake = TLSHandshake()
    >>> handshake.transition_to(HandshakeState.SERVER_HELLO)
    True
    >>> handshake.state
    <HandshakeState.SERVER_HELLO: 'SERVER_HELLO'>
"""

import enum
import logging
from typing import Dict, Set, Optional, Union

logger = logging.getLogger(__name__)


class HandshakeState(enum.Enum):
    """Represents the possible states of a TLS 1.3 handshake.

    Attributes:
        CLIENT_HELLO: Initial state, client sends ClientHello.
        SERVER_HELLO: Server responds with ServerHello.
        CERTIFICATE: Server sends its certificate.
        KEY_EXCHANGE: Key exchange messages are exchanged.
        CHANGE_CIPHER_SPEC: Change cipher spec message.
        FINISHED: Finished message exchanged, handshake complete.
        ESTABLISHED: TLS session established, data can be sent.
        ERROR: An invalid transition occurred, handshake is dead.
    """

    CLIENT_HELLO = "CLIENT_HELLO"
    SERVER_HELLO = "SERVER_HELLO"
    CERTIFICATE = "CERTIFICATE"
    KEY_EXCHANGE = "KEY_EXCHANGE"
    CHANGE_CIPHER_SPEC = "CHANGE_CIPHER_SPEC"
    FINISHED = "FINISHED"
    ESTABLISHED = "ESTABLISHED"
    ERROR = "ERROR"


# Valid state transitions for a TLS 1.3 handshake.
# Each key is the current state; the value is the set of allowed next states.
# Strict enforcement prevents skipping mandatory steps.
VALID_TRANSITIONS: Dict[HandshakeState, Set[HandshakeState]] = {
    HandshakeState.CLIENT_HELLO: {HandshakeState.SERVER_HELLO},
    HandshakeState.SERVER_HELLO: {HandshakeState.CERTIFICATE, HandshakeState.KEY_EXCHANGE},
    HandshakeState.CERTIFICATE: {HandshakeState.KEY_EXCHANGE},
    HandshakeState.KEY_EXCHANGE: {HandshakeState.CHANGE_CIPHER_SPEC},
    HandshakeState.CHANGE_CIPHER_SPEC: {HandshakeState.FINISHED},
    HandshakeState.FINISHED: {HandshakeState.ESTABLISHED},
    HandshakeState.ESTABLISHED: set(),
    HandshakeState.ERROR: set(),
}


class TLSHandshake:
    """Manages a single TLS 1.3 handshake session with strict state validation.

    The handshake starts in CLIENT_HELLO and must follow the defined state
    transitions. Invalid transitions move the session to ERROR, from which
    no recovery is possible. A reset() method is provided to start over.

    The class collects handshake messages and derives a master secret
    during the KEY_EXCHANGE transition.
    """

    def __init__(self) -> None:
        self._state: HandshakeState = HandshakeState.CLIENT_HELLO
        self._master_secret: Optional[bytes] = None
        self._handshake_messages: list[bytes] = []

    @property
    def state(self) -> HandshakeState:
        """Return the current handshake state."""
        return self._state

    @property
    def master_secret(self) -> Optional[bytes]:
        """Return the derived master secret, or None if not yet derived."""
        return self._master_secret

    def transition_to(
        self, new_state: HandshakeState, payload: Optional[bytes] = None
    ) -> bool:
        """Attempt to transition from the current state to *new_state*.

        Args:
            new_state: The target handshake state.
            payload: Optional bytes to record as a handshake message.
                     If provided, it is appended to the internal message list.

        Returns:
            True if the transition is valid and performed.
            False if the transition is invalid; the session enters ERROR state.

        Raises:
            ValueError: If *new_state* is not a HandshakeState enum member.

        The method enforces the rules defined in VALID_TRANSITIONS.
        If the transition is to KEY_EXCHANGE, the master secret is derived
        from the accumulated handshake messages.
        """
        # Validate input type
        if not isinstance(new_state, HandshakeState):
            raise ValueError(
                f"new_state must be a HandshakeState enum member, got {type(new_state).__name__}"
            )

        # Validate payload type if provided
        if payload is not None and not isinstance(payload, bytes):
            raise ValueError(
                f"payload must be bytes or None, got {type(payload).__name__}"
            )

        # Check if transition is allowed
        allowed: Set[HandshakeState] = VALID_TRANSITIONS.get(self._state, set())
        if new_state not in allowed:
            logger.error(
                "Invalid transition from %s to %s",
                self._state.value,
                new_state.value,
            )
            self._state = HandshakeState.ERROR
            return False

        # Record handshake message if provided
        if payload is not None:
            self._handshake_messages.append(payload)

        # Derive master secret exactly once on KEY_EXCHANGE
        if new_state == HandshakeState.KEY_EXCHANGE:
            self._derive_master_secret()

        # Perform state transition
        self._state = new_state
        logger.info("Transitioned to %s", new_state.value)
        return True

    def _derive_master_secret(self) -> None:
        """Derive the master secret from handshake messages (simplified).

        In this simplified implementation, the master secret is a concatenation
        of all handshake messages recorded so far. An empty list results in an
        empty bytes object.

        Note:
            In a production system this would perform real cryptographic key derivation.
        """
        if not self._handshake_messages:
            self._master_secret = b""
        else:
            # Use memory-efficient join for multiple byte strings
            self._master_secret = b"".join(self._handshake_messages)

    def verify_finished(self) -> bool:
        """Verify the integrity of the Finished message.

        Returns:
            True if the master secret is set, indicating that the key exchange
            has occurred and the handshake can be verified.
            False otherwise.

        In a production implementation this would perform cryptographic
        verification. Here it simply checks that a master secret exists.
        """
        if self._master_secret is None:
            logger.warning("Cannot verify Finished: master_secret is None")
            return False
        return True

    def reset(self) -> None:
        """Reset the handshake to its initial CLIENT_HELLO state.

        All accumulated messages and the master secret are cleared.
        """
        self._state = HandshakeState.CLIENT_HELLO
        self._master_secret = None
        self._handshake_messages.clear()
        logger.info("Handshake reset to CLIENT_HELLO")


if __name__ == "__main__":
    # Simple self-test to verify the handshake flow works.
    logging.basicConfig(level=logging.INFO)

    hs = TLSHandshake()
    assert hs.state == HandshakeState.CLIENT_HELLO

    # Valid full handshake
    assert hs.transition_to(HandshakeState.SERVER_HELLO, b"hello")
    assert hs.transition_to(HandshakeState.CERTIFICATE, b"cert")
    assert hs.transition_to(HandshakeState.KEY_EXCHANGE, b"key")
    assert hs.master_secret is not None
    assert hs.transition_to(HandshakeState.CHANGE_CIPHER_SPEC)
    assert hs.transition_to(HandshakeState.FINISHED, b"finish")
    assert hs.verify_finished()
    assert hs.transition_to(HandshakeState.ESTABLISHED)
    assert hs.state == HandshakeState.ESTABLISHED

    # Test invalid skip: CLIENT_HELLO -> FINISHED should fail
    hs.reset()
    assert hs.state == HandshakeState.CLIENT_HELLO
    result = hs.transition_to(HandshakeState.FINISHED)
    assert result is False
    assert hs.state == HandshakeState.ERROR

    # Test invalid input type
    try:
        hs.transition_to("INVALID")  # type: ignore
        assert False, "ValueError expected"
    except ValueError:
        pass

    # Test reset after error works
    hs.reset()
    assert hs.state == HandshakeState.CLIENT_HELLO
    assert hs.master_secret is None
    assert hs._handshake_messages == []

    print("All tests passed.")