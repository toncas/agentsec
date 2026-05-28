# Diagram 02 — Baseline Approval Flow

`agentsec approve` captures the most recently observed prompt and writes
an encrypted baseline.

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant CLI as agentsec CLI
    participant Proxy as AgentSec Proxy
    participant Cache as Recent-Prompt Cache<br/>(in-memory ring)
    participant Crypto as AES-256-GCM
    participant Store as BaselineStore (SQLite)
    participant Audit as audit_log

    Note over Proxy,Cache: Every observed prompt is held in a<br/>capped in-memory ring for `agentsec approve`.

    Dev->>CLI: agentsec approve
    CLI->>Proxy: GET /control/last-prompt<br/>(local UNIX socket)
    Proxy->>Cache: peek()
    Cache-->>Proxy: NormalizedPrompt
    Proxy-->>CLI: { provider, system, tools, hash }
    CLI->>Dev: Show diff vs. existing baseline (if any)
    Dev->>CLI: [y]
    CLI->>Crypto: encrypt(system + tools_json, AGENTSEC_KEY)
    Crypto-->>CLI: { ciphertext, iv, authTag, salt }
    CLI->>Store: upsertBaseline(project_id, provider, hash, ciphertext, ...)
    Store-->>CLI: ok
    CLI->>Audit: insert(decision='rebaseline')
    CLI-->>Dev: Baseline saved.

    Note over Proxy: Next request reads the new baseline.<br/>No proxy restart needed.
```

**Atomicity:** `better-sqlite3` serializes writes. A concurrent inbound
request reads either the old baseline (if its read happened first) or the
new baseline (if the approve committed first) — never a partial state.

**Security:** Plaintext never leaves CLI memory. Encryption happens before
the SQLite write. The encryption key (`AGENTSEC_KEY`) is read from env at
CLI invocation time and discarded on process exit.
