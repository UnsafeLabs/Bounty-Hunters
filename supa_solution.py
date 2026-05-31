 Just the code.
```python
```python
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
import os

# Config for API key rate limiting
rate_limit = os.getenv("API_KEY_RATE_LIMIT") or "1000"
key_rotation_period = os.getenv("API_KEY_KEY_ROTATION") or timedelta(minutes=1)

def get_api_key():
    return os.getenv('API_KEY') or 'default_key'

def get_api_key_with_rate_limit():
    # Cache for API key expiration
    cache = {}
    current_time = datetime.now()
    
    def _get(key):
        if key not in cache:
            cache[key] = current_time
            if current_time > datetime.now() - timedelta(minutes=1):
                cache[key] = current_time + timedelta(minutes=1)
        return cache[key]
    
    def _rotate(key):
        # Rotate key every key_rotation_period
        key = os.getenv('API_KEY_KEY') or '0'
        if key not in cache:
            cache[key] = current_time
            if current_time > datetime.now() - timedelta(minutes=1):
                cache[key] = current_time + timedelta(minutes=1)
        else:
            # Rotate key
            key = os.getenv('API_KEY_KEY') or '0'
            cache[key] = current_time
            if current_time > datetime.now() - timedelta(minutes=1):
                cache[key] = current_time +