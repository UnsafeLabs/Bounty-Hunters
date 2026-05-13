import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class RustMissingTicketStaticTests(unittest.TestCase):
    def test_get_session_uses_option_short_circuit_not_unwrap(self):
        source = (ROOT / "rust" / "tls_session.rs").read_text()
        get_session = source.split("pub fn get_session", 1)[1].split("pub fn remove_session", 1)[0]

        self.assertIn("let ticket = self.cache.get(ticket_id)?;", get_session)
        self.assertNotIn(".unwrap()", get_session)


if __name__ == "__main__":
    unittest.main()
