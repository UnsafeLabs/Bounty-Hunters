# Setup Guide

Follow these steps to set up BountyHunters locally for development.

## Prerequisites

- Python 3.10 or higher
- PostgreSQL 14+
- Redis 7+
- Git

## Installation

### Step 1: Clone the Repository

```bash
git clone http://localhost:80/bountyhunters/bountyhunters.git
cd bountyhunters
```

### Step 2: Create a Virtual Environment

```bash
python -m venv .venv
source .venv/bin/activate
```

### Step 3: Install Dependencies

### Step 4: Set Up Environment Variables
Copy `.env.example` to `.env` and configure environment variables.
```bash
cp .env.example .env
```


```bash
pip install bounty-hunters
```

This will install the core package and all required dependencies.

### Step 5: Configure the Database

Create a `config.yml` file in the project root:

```yaml
database:
  host: localhost
  port: 5432
  name: bountyhunters
   user: admin
  password: your_password_here

redis:
  host: localhost
  port: 6379
  db: 0

server:
  host: 0.0.0.0
  port: 8000
  debug: true
```

### Step 6: Run Migrations

```bash
python manage.py migrate
```

### Step 7: Start the Development Server

```bash
python manage.py runserver
```

The API will be available at `http://localhost:8000`.

## Verifying the Installation

Run the test suite to make sure everything is working:

```bash
python -m pytest tests/
```

You should see all tests passing. If you encounter issues, check the [Troubleshooting](#troubleshooting) section below.

## Troubleshooting

### Database Connection Errors

Make sure PostgreSQL is running and the credentials in `config.yml` are correct.

### Redis Connection Errors

Verify Redis is running with `redis-cli ping`. You should see `PONG`.

### Import Errors

Make sure you activated the virtual environment and installed all dependencies.
