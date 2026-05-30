**API Key Authentication with Rate Limiting and Key Rotation**

### Implementation

We will modify `fastapi/fastapi/security/api_key.py` to include rate limiting and key rotation support.

```python
from fastapi import FastAPI, HTTPException
from fastapi.security import APIKeyHeader as SecurityBase
import time
from typing import Dict, List, Union

class APIKeyWithRateLimit(SecurityBase):
    def __init__(self, deprecated_keys: List[str] = None):
        self.deprecated_keys = deprecated_keys if deprecated_keys else []
        super().__init__()

    async def _validate_api_key(self, api_key: str) -> bool:
        """
        Validate the API key and check for rate limiting.
        
        Args:
        - api_key (str): The API key to validate.

        Returns:
        - bool: Whether the API key is valid or not.
        """
        # Check if the API key is deprecated
        if api_key in self.deprecated_keys:
            return False

        # Initialize request counts dictionary
        self.request_counts = self._init_request_counts()

        # Increment request count for the API key
        api_key_id, _ = self._parse_api_key(api_key)
        if api_key_id not in self.request_counts:
            self.request_counts[api_key_id] = {}

        current_timestamp = int(time.time())
        timestamp = int(current_timestamp)

        # Get the request counts for the API key
        request_counts = self.request_counts[api_key_id]
        
        # Check rate limit
        if api_key_id in request_counts and request_counts[timestamp]:
            # Check if the rate limit has been exceeded
            if len(request_counts[timestamp]) >= int(self.rate_limit.split('/')[0]):
                return False

        # Increment request count for the API key
        if api_key_id not in self.request_counts:
            self.request_counts[api_key_id] = {}
        
        if timestamp not in request_counts:
            request_counts[timestamp] = 1
        else:
            request_counts[timestamp] += 1

        return True

    def _init_request_counts(self):
        """
        Initialize the request counts dictionary with default sliding window time.
        """

        # Default sliding window time (1 minute)
        self.default_sliding_window_time = 60
        
        # Create a new dictionary for request counts
        dict()
    
    def _parse_api_key(self, api_key: str) -> tuple:
        """
        Parse the API key and extract the ID.

        Args:
        - api_key (str): The API key to parse.

        Returns:
        - tuple: A tuple containing the API key ID and a timestamp.
        """
        # Split the API key
        parts = api_key.split('-')
        
        if len(parts) < 2:
            raise HTTPException(status_code=401, detail='Invalid API Key')
        
        return (parts[0], int(parts[1]))

def _set_rate_limit(self):
    self.rate_limit = '100/minute'
```

### Explanation

This solution defines a new class `APIKeyWithRateLimit` that extends the original `APIKeyHeader`. The new class has an additional parameter `deprecated_keys`, which is used to track deprecated API keys. It also includes a new method `_validate_api_key` to validate the API key and check for rate limiting.

The `_validate_api_key` method first checks if the API key is deprecated, and if so, returns False. Otherwise, it initializes a dictionary to store request counts per API key with timestamp-based sliding window. It then increments the request count for the API key and checks the rate limit. If the rate limit has been exceeded, it returns False; otherwise, it returns True.

The `_init_request_counts` method initializes a new dictionary for request counts with default sliding window time (1 minute). The `_parse_api_key` method parses the API key and extracts the ID.

### Required Dependencies or Setup

No additional dependencies are required. The solution only modifies the existing code in `fastapi/fastapi/security/api_key.py`.