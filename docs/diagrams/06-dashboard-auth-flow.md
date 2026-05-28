# Diagram 06 — Dashboard Auth Flow

Standard JWT login + refresh for the AgentSec Cloud dashboard. Used only
by the hosted web UI; the local proxy uses a long-lived API key.

```mermaid
sequenceDiagram
    autonumber
    actor User as Dashboard User
    participant UI as Dashboard<br/>(SPA)
    participant API as AgentSec Cloud<br/>(/auth/*)
    participant DB as Postgres<br/>(users, refresh_tokens)
    participant Rate as Rate Limiter

    User->>UI: Enter email + password
    UI->>API: POST /auth/login<br/>{ email, password }
    API->>Rate: check(ip, email)
    alt rate limited
        Rate-->>API: deny
        API-->>UI: 429 Too Many Requests
    else allowed
        Rate-->>API: ok
        API->>DB: SELECT user WHERE email=?
        DB-->>API: row { id, password_hash }
        API->>API: argon2.verify(password, hash)
        alt invalid
            API-->>UI: 401 Unauthorized
        else valid
            API->>API: sign access_token (JWT, 15min)
            API->>API: generate refresh_token (256-bit random)
            API->>DB: INSERT refresh_token (user_id, hash, expires_at +30d)
            API-->>UI: 200 { access_token, refresh_token,<br/>token_type:'Bearer', expires_in:900 }
            UI->>UI: store access in memory,<br/>refresh in httpOnly cookie
        end
    end

    Note over UI,API: Subsequent API calls

    UI->>API: GET /v1/events<br/>Authorization: Bearer <access>
    API->>API: verify JWT signature + expiry
    API-->>UI: 200 [events]

    Note over UI,API: Access token expires

    UI->>API: GET /v1/events (expired token)
    API-->>UI: 401 token_expired
    UI->>API: POST /auth/refresh<br/>{ refresh_token }
    API->>DB: SELECT refresh_token WHERE hash=?<br/>AND expires_at > now()
    alt not found / expired
        DB-->>API: empty
        API-->>UI: 401 — force re-login
    else valid
        DB-->>API: row
        API->>DB: rotate: delete old, insert new
        API->>API: sign new access_token
        API-->>UI: 200 { access_token, refresh_token, ... }
        UI->>API: retry original call with new access
    end
```

**Security properties:**
- Passwords hashed with Argon2id (server-side; AGENTSEC_KEY is unrelated).
- Refresh tokens are rotated on every use (compromise detection: if an
  old refresh token is presented, all tokens for that user are revoked).
- Rate limiter: 5 failed logins per email per 10 min, plus per-IP cap.
- Access token JWT is 15 min; refresh token cookie is httpOnly + SameSite=Strict + Secure.
- The hosted Cloud API is OPTIONAL — the local AgentSec proxy works fully without it.

**Separation of concerns:**
- The local proxy uses an API key (header `Authorization: Bearer <key>`),
  not JWT. API keys are issued from the dashboard.
- Compromise of a dashboard JWT does not compromise the local
  `AGENTSEC_KEY` (which never leaves the developer's machine).
