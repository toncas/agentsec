# Diagram 01 — Proxy Intercept Flow (Happy Path)

Clean request that passes all detectors and is forwarded to upstream.

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant Agent as AI Agent<br/>(Claude Code)
    participant Proxy as AgentSec Proxy<br/>(:7777)
    participant Extract as SystemPromptExtractor
    participant Pipe as DetectionPipeline
    participant Store as BaselineStore
    participant Up as Upstream API<br/>(api.anthropic.com)
    participant Audit as audit_log (SQLite)

    Dev->>Agent: "refactor src/api.ts"
    Agent->>Proxy: POST /v1/messages<br/>(system, tools, messages)
    Proxy->>Extract: extract(req.body)
    Extract-->>Proxy: NormalizedPrompt
    Proxy->>Store: getBaseline(project_id, anthropic)
    Store-->>Proxy: Baseline
    Proxy->>Pipe: run(ctx)

    par Detectors run in declared order
        Pipe->>Pipe: HashChange.detect()
        Pipe->>Pipe: Injection.detect()
        Pipe->>Pipe: Exfiltration.detect()
        Pipe->>Pipe: PermissionEscalation.detect()
        Pipe->>Pipe: Drift.detect()
    end

    Pipe-->>Proxy: ThreatReport(triggered=false)
    Proxy->>Audit: insert(decision='clean')
    Proxy->>Up: forward request (stream.pipeline)
    Up-->>Proxy: SSE stream chunks
    Proxy-->>Agent: SSE stream chunks (unchanged)
    Agent-->>Dev: Refactored code
```

**Performance contract:** P50 overhead ≤ 50ms vs direct upstream call
(NFR-1). The pipeline runs synchronously; only the upstream HTTP call is
async-streamed.

**Memory contract:** Request and response bodies are never accumulated in
memory. `stream.pipeline()` handles backpressure end-to-end.
