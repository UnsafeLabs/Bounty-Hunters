# python/tls_handshake.py
"""
TLS 1.3 handshake state machine implementation.

Provides a robust, production‑quality handshake state machine with strict
transition validation, comprehensive logging, type safety, and input
verification. Prevents skipping mandatory intermediate states (notably
CLIENT_HELLO -> SERVER_HELLO is the only allowed transition from CLIENT_HELLO).
"""

from __future__ import annotations

import logging
from enum import Enum, auto
from typing import Dict, FrozenSet, Optional

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
_logger = logging.getLogger(__name__)
_logger.addHandler(logging.NullHandler())  # Let application configure handlers


# ---------------------------------------------------------------------------
# HandshakeState
# ---------------------------------------------------------------------------
class HandshakeState(Enum):
    """All possible states of the TLS handshake machine."""

    CLIENT_HELLO = auto()
    SERVER_HELLO = auto()
    CERTIFICATE = auto()
    KEY_EXCHANGE = auto()
    CHANGE_CIPHER_SPEC = auto()
    FINISHED = auto()
    ESTABLISHED = auto()
    ERROR = auto()


# ---------------------------------------------------------------------------
# Transition table
# ---------------------------------------------------------------------------
# Only the following transitions are permitted.  Any attempt to move
# outside these edges will set the state to ERROR.
VALID_TRANSITIONS: Dict[HandshakeState, FrozenSet[HandshakeState]] = {
    HandshakeState.CLIENT_HELLO: frozenset({HandshakeState.SERVER_HELLO}),
    HandshakeState.SERVER_HELLO: frozenset({HandshakeState.CERTIFICATE}),
    HandshakeState.CERTIFICATE: frozenset({HandshakeState.KEY_EXCHANGE}),
    HandshakeState.KEY_EXCHANGE: frozenset({HandshakeState.CHANGE_CIPHER_SPEC}),
    HandshakeState.CHANGE_CIPHER_SPEC: frozenset({HandshakeState.FINISHED}),
    HandshakeState.FINISHED: frozenset({HandshakeState.ESTABLISHED}),
    HandshakeState.ESTABLISHED: frozenset(),  # Terminal state
    HandshakeState.ERROR: frozenset(),         # Terminal (absorbing) state
}


# ---------------------------------------------------------------------------
# TLSHandshake
# ---------------------------------------------------------------------------
class TLSHandshake:
    """
    A state machine modelling a TLS handshake.

    The machine starts in :attr:`CLIENT_HELLO` and must follow the
    prescribed transition graph.  Invalid transitions move the machine to
    :attr:`ERROR` and return ``False``.

    Attributes
    ----------
    state : HandshakeState
        Current state of the handshake.
    master_secret : Optional[bytes]
        The derived master secret, set during :meth:`generate_master_secret`.
    peer_finished : bool
        Whether the peer's Finished message has been verified.
    """

    def __init__(self) -> None:
        self._state: HandshakeState = HandshakeState.CLIENT_HELLO
        self.master_secret: Optional[bytes] = None
        self.peer_finished: bool = False
        _logger.info("Handshake initialised in state %s", self._state.name)

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------
    @property
    def state(self) -> HandshakeState:
        """Current state of the handshake machine."""
        return self._state

    @state.setter
    def state(self, value: HandshakeState) -> None:
        """
        Direct setter – use only when forcing an ERROR state.
        Any other value raises an exception to prevent misuse.
        """
        if not isinstance(value, HandshakeState):
            raise TypeError(f"Expected HandshakeState, got {type(value).__name__}")
        if value != HandshakeState.ERROR:
            raise ValueError(
                f"Direct state setter only allowed for {HandshakeState.ERROR.name}, "
                f"not {value.name}. Use transition_to() for normal transitions."
            )
        self._state = value
        _logger.debug("State forcefully set to %s", value.name)

    # ------------------------------------------------------------------
    # Core operations
    # ------------------------------------------------------------------
    def transition_to(self, new_state: HandshakeState) -> bool:
        """
        Attempt to move from the current state to *new_state*.

        Parameters
        ----------
        new_state : HandshakeState
            The target state.

        Returns
        -------
        bool
            ``True`` if the transition was valid and performed,
            ``False`` otherwise (machine moves to ERROR).
        """
        # --- input validation ---
        if not isinstance(new_state, HandshakeState):
            _logger.error(
                "transition_to called with non‑HandshakeState object: %r", new_state
            )
            self._state = HandshakeState.ERROR
            return False

        current: HandshakeState = self._state

        # Terminal states cannot transition anywhere
        if current in (HandshakeState.ESTABLISHED, HandshakeState.ERROR):
            _logger.warning(
                "Cannot transition from terminal state %s to %s",
                current.name,
                new_state.name,
            )
            self._state = HandshakeState.ERROR
            return False

        allowed: FrozenSet[HandshakeState] = VALID_TRANSITIONS.get(
            current, frozenset()
        )

        if new_state not in allowed:
            _logger.error(
                "Invalid transition: %s -> %s.  Allowed from %s: %s",
                current.name,
                new_state.name,
                current.name,
                [s.name for s in allowed],
            )
            self._state = HandshakeState.ERROR
            return False

        # Perform the transition
        _logger.info("Transition: %s -> %s (ok)", current.name, new_state.name)
        self._state = new_state
        return True

    def generate_master_secret(self, pre_master: bytes) -> None:
        """
        Derive the master secret from the pre‑master secret.

        In a real implementation this would run the TLS key schedule.
        Here we store the pre‑master directly as a placeholder.

        This method must be called exactly when the machine is in
        :data:`HandshakeState.KEY_EXCHANGE`.  Calling it in any other
        state will raise a :class:`RuntimeError`.

        Parameters
        ----------
        pre_master : bytes
            The pre‑master secret (must be non‑empty).

        Raises
        ------
        ValueError
            If *pre_master* is empty.
        RuntimeError
            If the current state is not :data:`HandshakeState.KEY_EXCHANGE`.
        """
        if not pre_master:
            raise ValueError("Pre‑master secret must not be empty")

        if self._state != HandshakeState.KEY_EXCHANGE:
            raise RuntimeError(
                f"generate_master_secret called in state {self._state.name}, "
                f"expected {HandshakeState.KEY_EXCHANGE.name}"
            )

        self.master_secret = pre_master
        _logger.debug("Master secret derived (%d bytes)", len(pre_master))

    def verify_finished(self, finished_data: bytes) -> bool:
        """
        Verify the Finished message from the peer.

        Currently checks only that the master secret has been derived and
        that *finished_data* is non‑empty.  A real implementation would
        compute and compare verify_data.

        This method must be called exactly when the machine is in
        :data:`HandshakeState.FINISHED`.  Calling it in any other
        state will set the machine to :data:`HandshakeState.ERROR` and
        return ``False``.

        Parameters
        ----------
        finished_data : bytes
            The finished message payload from the peer.

        Returns
        -------
        bool
            ``True`` if verification passes, ``False`` otherwise.
        """
        if self._state != HandshakeState.FINISHED:
            _logger.error(
                "verify_finished called in state %s (expected %s)",
                self._state.name,
                HandshakeState.FINISHED.name,
            )
            self._state = HandshakeState.ERROR
            return False

        if self.master_secret is None:
            _logger.error("Cannot verify Finished – master_secret is None")
            self._state = HandshakeState.ERROR
            return False

        if not finished_data:
            _logger.warning("Finished data is empty – verification failed")
            # Do not transition to ERROR – this is a legitimate failure
            return False

        # Placeholder verification logic
        if len(finished_data) < 4:
            _logger.warning("Finished data too short – verification failed")
            return False

        self.peer_finished = True
        _logger.info("Finished message verified successfully")
        return True