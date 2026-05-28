# Diagram 05 — Cloud Sync Flow (Pro/Team, Opt-In)

Encrypted metadata-only sync to AgentSec cloud. NEVER raw prompt content.

```mermaid
sequenceDiagram
    autonumber
    participant Proxy as AgentSec Proxy
    participant Audit as audit_log (SQLite)
    participant Queue as cloud_sync_queue
    participant Sync as CloudSync<br/>(background tick, 60s)
    participant Allow as Allow-list Serializer
    participant Cloud as agentsec.dev/api<br/>/v1/events
    participant FailLog as cloud_sync_failures.log

    Note over Proxy: Detection completes;<br/>audit row already written.
    Proxy->>Audit: insert(decision, detector_names, ...)
    Proxy->>Queue: enqueue(audit_row_id)

    loop every 60s
        Sync->>Queue: dequeue batch (up to 100)
        Queue-->>Sync: rows[]
        Sync->>Allow: serialize(rows)
        Note over Allow: Allow-list ONLY:<br/>timestamp, project_id, provider,<br/>detector_name, decision,<br/>prompt_hash, severity.<br/>ANY other field is dropped.<br/>Raw prompt content is impossible —<br/>it was never in the audit row.
        Allow-->>Sync: minimised JSON
        Sync->>Cloud: POST /v1/events<br/>Authorization: Bearer <api_key>
        alt 2xx
            Cloud-->>Sync: 202 { accepted: N }
            Sync->>Queue: delete batch
        else 4xx/5xx or timeout
            Cloud--xSync: error
            Sync->>FailLog: append({ error, attempt })
            Sync->>Queue: update last_attempt_at, increment attempts
            Note over Queue: Retried next tick with<br/>exponential backoff capped at 1h.
        end
    end
```

**Cloud sync is OFF by default (FR-16).** Two flags required to enable:

```bash
export AGENTSEC_CLOUD_API_KEY="..."
agentsec config --enable-cloud-sync
```

Even with the API key set, sync remains disabled until explicit opt-in.

**Schema enforcement (defence in depth):**
- Local serializer is allow-list based (rejects extra keys).
- Cloud API OpenAPI schema uses `additionalProperties: false` and rejects
  unknown keys with HTTP 400.
- Fuzz test in `tests/unit/cloud-sync.test.ts` injects 100 random keys
  into the audit row and asserts none reach the wire.

**Resilience:** Sync failures never affect detection. The proxy is fully
operational with cloud down or unreachable.
