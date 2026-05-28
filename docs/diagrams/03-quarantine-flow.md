# Diagram 03 — Quarantine Flow (Threat Detected)

Detector triggers → quarantine → terminal diff prompt → user decides.

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant Agent as AI Agent
    participant Proxy as AgentSec Proxy
    participant Pipe as DetectionPipeline
    participant State as QuarantineStateMachine
    participant Term as TerminalNotifier
    participant Audit as audit_log
    participant Up as Upstream API

    Agent->>Proxy: POST /v1/messages (modified system prompt)
    Proxy->>Pipe: run(ctx)
    Pipe-->>Proxy: ThreatReport(triggered=true,<br/>highest=warn,<br/>hits=[HashChange, Injection])

    Proxy->>State: transition(intercepted)
    State->>State: sensitivity gate (balanced + warn → quarantine)
    State->>Term: present(report, diff, timeout=60s)

    alt TTY available
        Term->>Dev: Render unified diff +<br/>"[y]es / [n]o / [a]pprove+rebaseline"
        alt User answers 'y' before timeout
            Dev->>Term: y
            Term-->>State: approve(rebaseline=false)
            State->>Audit: insert(decision='approved')
            State->>Proxy: forward
            Proxy->>Up: forward request
            Up-->>Agent: response
        else User answers 'a'
            Dev->>Term: a
            Term-->>State: approve(rebaseline=true)
            State->>Audit: insert(decision='rebaseline')
            Note over State: BaselineStore.upsert(new hash)
            State->>Proxy: forward
            Proxy->>Up: forward request
        else User answers 'n' or times out
            Dev-->>Term: n / (no input)
            Term-->>State: block(reason='user_deny' | 'timeout')
            State->>Audit: insert(decision='blocked')
            State-->>Proxy: deny
            Proxy-->>Agent: HTTP 403 + ThreatReport JSON
        end
    else No TTY (CI, background)
        Term-->>State: block(reason='no_tty')
        State->>Audit: insert(decision='blocked')
        State-->>Proxy: deny
        Proxy-->>Agent: HTTP 403
    end
```

**Fail-secure invariants (NFR-9):**
- Timeout → block, never approve.
- No TTY → block immediately, never approve.
- Process crash mid-quarantine → block (request was never forwarded).
- The only paths to `approved` require explicit human input.

**Observability:** Every decision writes one row to `audit_log` with the
detector names and severity. `quarantine_timeouts.log` is appended on
timeout-blocks for ops review.
