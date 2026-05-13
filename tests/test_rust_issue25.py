import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class RustTicketAgeStaticTests(unittest.TestCase):
    def test_ticket_age_uses_current_time_minus_issued_at(self):
        source = (ROOT / "rust" / "tls_session.rs").read_text()
        calculate_age = source.split("fn calculate_ticket_age", 1)[1].split("fn evict_expired_sessions", 1)[0]

        self.assertIn("SystemTime::now()", calculate_age)
        self.assertIn("now.saturating_sub(ticket.issued_at)", calculate_age)
        self.assertNotIn("ticket.issued_at.saturating_sub(ticket.creation_time)", calculate_age)


if __name__ == "__main__":
    unittest.main()
