
import unittest
import sys
import os

# Add the current directory to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tls_handshake import TLSHandshake

class TestCheckExpiry(unittest.TestCase):
    """Test cases for check_expiry function."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.handshake = TLSHandshake()
    
    def test_normal_expiry(self):
        """Test normal expiry case."""
        current_time = 1000
        timestamp = 900
        max_age = 50
        self.assertTrue(self.handshake.check_expiry(timestamp, current_time, max_age))
    
    def test_not_expired(self):
        """Test case where timestamp is not expired."""
        current_time = 1000
        timestamp = 980
        max_age = 50
        self.assertFalse(self.handshake.check_expiry(timestamp, current_time, max_age))
    
    def test_future_timestamp(self):
        """Test case where timestamp is in the future."""
        current_time = 1000
        timestamp = 1100
        max_age = 50
        self.assertTrue(self.handshake.check_expiry(timestamp, current_time, max_age))
    
    def test_overflow_protection(self):
        """Test protection against integer overflow."""
        # Large numbers that could cause overflow
        current_time = 2**63 - 1
        timestamp = 2**63 - 100
        max_age = 50
        # Should not raise OverflowError
        result = self.handshake.check_expiry(timestamp, current_time, max_age)
        self.assertIsInstance(result, bool)
    
    def test_edge_cases(self):
        """Test edge cases."""
        # Zero values
        self.assertTrue(self.handshake.check_expiry(0, 100, 50))
        
        # Negative values
        self.assertTrue(self.handshake.check_expiry(-100, 100, 50))
        
        # Large values
        self.assertFalse(self.handshake.check_expiry(10**18, 10**18 + 10, 50))

if __name__ == '__main__':
    unittest.main()
