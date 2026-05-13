import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class RustSessionCacheLockStaticTests(unittest.TestCase):
    def test_session_cache_uses_rwlock_for_shared_map_access(self):
        source = (ROOT / "rust" / "tls_session.rs").read_text()

        self.assertIn("use std::sync::RwLock;", source)
        self.assertIn("cache: Arc<RwLock<HashMap<String, SessionTicket>>>", source)
        self.assertIn("cache: Arc::new(RwLock::new(HashMap::new()))", source)
        self.assertIn("let mut inner = self.cache.write()", source)
        self.assertIn("let inner = self.cache.read()", source)
        self.assertNotIn("Arc alone does not provide interior mutability", source)


if __name__ == "__main__":
    unittest.main()
