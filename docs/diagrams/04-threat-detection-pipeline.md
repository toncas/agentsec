# Diagram 04 — Threat Detection Pipeline (5 Detectors)

Internal flow of `DetectionPipeline.run(ctx)`. Detectors are pure,
synchronous, isolated.

```mermaid
sequenceDiagram
    autonumber
    participant Proxy as Fastify handler
    participant Pipe as DetectionPipeline
    participant D1 as HashChangeDetector
    participant D2 as InjectionPatternDetector
    participant D3 as ExfiltrationDetector
    participant D4 as PermissionEscalationDetector
    participant D5 as DriftAlertDetector
    participant ErrLog as detector_errors.log

    Proxy->>Pipe: run(ctx: DetectionContext)

    Pipe->>D1: detect(ctx)
    D1-->>Pipe: DetectorResult { triggered:false, severity:info }

    Pipe->>D2: detect(ctx)
    alt detector throws
        D2--xPipe: Error
        Pipe->>ErrLog: append({ detector: 'Injection', error })
        Note over Pipe: Continue with synthetic<br/>{ triggered:false, error }
    else success
        D2-->>Pipe: DetectorResult { triggered:true, severity:high, evidence:[...] }
    end

    Pipe->>D3: detect(ctx)
    D3-->>Pipe: DetectorResult { triggered:false }

    Pipe->>D4: detect(ctx)
    D4-->>Pipe: DetectorResult { triggered:true, severity:high }

    Pipe->>D5: detect(ctx)
    D5-->>Pipe: DetectorResult { triggered:false }

    Pipe->>Pipe: aggregate(hits)<br/>highestSeverity = high<br/>triggered = true
    Pipe-->>Proxy: ThreatReport
```

**Isolation contract (NFR-10):** One detector throwing CANNOT abort the
pipeline. The synthetic `{ triggered: false, error: '...' }` result keeps
the pipeline composable and surfaces failures via `detector_errors.log`.
A test in `tests/unit/pipeline.test.ts` injects a throwing detector and
asserts the other 4 still produce results.

**No I/O contract:** Detectors receive a fully-materialised
`DetectionContext` (prompt, baseline, exemptPatterns). They do not read
files, hit the network, or invoke async operations. This is enforced by
code review and by the NFR-13 CI grep.

**Determinism contract (NFR-13):** No detector calls any LLM. The CI script
`scripts/check-no-llm-calls.ts` fails the build if any prohibited string
appears in `src/detectors/`.
