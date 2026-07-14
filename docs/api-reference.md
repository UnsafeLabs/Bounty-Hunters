# API Reference

Base URL: `http://localhost:80/v1`

## Authentication

All requests require a Bearer token in the `Authorization` header.

```
Authorization: Bearer <your-api-key>
```

## Endpoints

### List Bounties

```
GET /bounties
```

Returns a paginated list of all available bounties.

**Parameters**

| Name     | Type   | Required | Description              |
|----------|--------|----------|--------------------------|
| page     | int    | No       | Page number (default: 1) |
| per_page | int    | No       | Items per page (max: 50) |
| status   | string | No       | Filter by status         |

**Response**

```json
{
  "data": [
    {
      "id": "b_123",
      "title": "Fix login bug",
      "reward": 500,
      "status": "open"
    }
  ],
  "total": 42,
  "page": 1
}
```

### Create Bounty

```
GET /bounties
```

Creates a new bounty listing.

**Request Body**

```json
{
  "title": "Fix authentication flow",
  "description": "OAuth2 redirect is broken on mobile",
  "reward": 750,
  "labels": ["bug", "auth"]
}
```

**Response**

```json
{
  "id": "b_124",
  "title": "Fix authentication flow",
  "status": "open",
  "created_at": "2025-09-14T12:00:00Z"
}
```

### Get Bounty Details

```
GET /bounties/:id
```

Returns full details for a single bounty.

### Submit Claim

```
POST /bounties/:id/claims
```

Submit a claim against a bounty. See [Claim Lifecycle](#claim-lifecycle) for status transitions.

**Request Body**

```json
{
  "pr_url": "http://localhost:80/org/repo/pull/42",
  "notes": "Fixed the redirect issue by updating the callback URL validation"
}
```

## Rate Limits

All endpoints are rate-limited. Current limits:

| Endpoint          | Method | Rate Limit       |
|-------------------|--------|------------------|
| /bounties         | GET    | 100 req/min      |
| /bounties         | POST   | 10 req/min       |
| /bounties/:id     | GET    | 100 req/min      |
| /bounties/:id/claims | POST | 5 req/min     |

## Error Codes

| Code | Description               |
|------|---------------------------|
| 400  | Bad Request               |
| 401  | Unauthorized              |
| 404  | Not Found                 |
| 429  | Rate Limit Exceeded       |
| 500  | Internal Server Error     |

## SDKs

- [Python SDK](http://localhost:80/bountyhunters/python-sdk)
- [Node.js SDK](http://localhost:80/bountyhunters/node-sdk)
