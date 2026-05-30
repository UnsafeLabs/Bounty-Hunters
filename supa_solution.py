 No markdown. Only the final code. Also, no extra text. Just the code.
```python
```python
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from datetime import datetime, timedelta
import os

# Config for API key rate limiting
rate_limit = os.getenv("API_KEY_RATE_LIMIT") or "1000"
key_rotation_period = os.getenv("API_KEY_KEY_ROTATION") or timedelta(minutes=1)

def get_api_key():
    return f"{os.getenv('API_KEY')} {rate_limit}"

def get_api_key_with_rate_limit():
    # Initialize cache
    cache = {}
    timestamp = datetime.now()
    
    def _get(key):
        if key not in cache:
            cache[key] = timestamp
            if timestamp > datetime.now() - timedelta(minutes=1):
                cache[key] = timestamp + timedelta(minutes=1)
        return cache[key]
    
    def _rotate(key):
        # Rotate key every key_rotation_period
        key = os.getenv('API_KEY_KEY') or '0'
        if key not in cache:
            cache[key] = timestamp
            if timestamp > datetime.now() - timedelta(minutes=1):
                cache[key] = timestamp + timedelta(minutes=1)
        else:
            # Rotate key
            key = os.getenv('API_KEY_KEY') or '0'
            cache[key] = timestamp
            if timestamp > datetime.now() - timedelta(minutes=