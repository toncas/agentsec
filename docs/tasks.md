# AgentSec — Task Breakdown (Phase 1)

TDD task list. Each task follows the standing RED → GREEN sequence defined in
[`copilot-instructions.md`](./copilot-instructions.md).

**Definition of Done** (every task):

1. RED commit (`test(<scope>): RED — <description>`)
2. GREEN commit (`fix(<scope>): GREEN — ...` or `feat(<scope>): GREEN — ...`)
3. `npx vitest run` clean, zero regressions
4. Acceptance criteria all checked
5. Docs updated per the docs-freshness table
6. NFR-13 unviolated (no LLM calls in detection pipeline)

**Traceability format**: every task lists `Satisfies: FR-XX, NFR-XX, …` and the
`scripts/check-traceability.ts` CI script enforces full coverage.

---

## Phase 1 — Sprint Plan Overview

| Sprint | Tasks                   | Duration | Focus                                              |
| ------ | ----------------------- | -------- | -------------------------------------------------- |
| S1     | T1.1–T1.3               | Week 1   | Project scaffolding + proxy happy path             |
| S2     | T1.4–T1.11              | Week 2   | Baseline store + 5 detectors                       |
| S3     | T1.12–T1.13             | Week 3   | Quarantine state machine + terminal UX             |
| S4     | T1.14–T1.18             | Week 4   | CLI surface + integration tests                    |
| S5     | T1.19–T1.22             | Week 5   | Multi-provider + Pro-tier scaffolding + cloud sync |
| S6     | T1.23–T1.25 + docs sync | Week 6   | Hardening, e2e tests, launch prep                  |

---

## Tasks

### T1.1 — Project scaffolding

**Satisfies:** NFR-5, NFR-11, NFR-12
**Dependencies:** none

Initialise the AgentSec repository with TypeScript strict mode, Vitest,
Commander.js, Fastify, better-sqlite3. Apache 2.0 LICENSE file. README
stub. `.env.example`. CI workflow (`.github/workflows/ci.yml`) runs:
`npm install`, `npx vitest run`, `npm run lint`,
`scripts/check-no-llm-calls.ts`, `scripts/check-traceability.ts`.

**Acceptance:**

- [ ] `npm install` + `npx vitest run` works on a clean clone
- [ ] `tsconfig.json` has `"strict": true`
- [ ] CI workflow runs all gates on push
- [ ] LICENSE = Apache 2.0
- [ ] `scripts/check-no-llm-calls.ts` exists and passes on empty `src/`

**RED commit:** `test(infra): RED — CI must run vitest + no-LLM-calls check`
**GREEN commit:** `feat(infra): GREEN — scaffold TypeScript + Vitest + Fastify + CI`

---

### T1.2 — Fastify proxy happy-path (forward + stream)

**Satisfies:** FR-1, FR-2, NFR-1, NFR-4
**Dependencies:** T1.1

Implement `src/proxy/server.ts`. The proxy accepts
`POST /v1/messages` and forwards the request to the upstream URL
(`AGENTSEC_UPSTREAM_URL`, default `https://api.anthropic.com`). Uses
`stream.pipeline()` to forward and pipe back the response.

**Tests** (`tests/integration/proxy-happy-path.test.ts`):

- Start real Fastify proxy AND a real Fastify fake-upstream on ephemeral ports
- Send POST /v1/messages with a JSON body
- Assert fake-upstream received the body unchanged
- Assert client received upstream response unchanged
- Assert SSE chunks arrive in order without buffering
- Assert two sequential requests both succeed (warm→warm per TDD heuristic 7)

**Acceptance:**

- [ ] All 4 happy-path tests pass
- [ ] Memory delta across 100 sequential requests < 5 MB
- [ ] No request body retained in memory after response completes
- [ ] P50 overhead < 50ms vs. direct fake-upstream

**RED commit:** `test(proxy): RED — proxy must forward POST /v1/messages and stream response unchanged`
**GREEN commit:** `feat(proxy): GREEN — Fastify proxy with stream.pipeline forwarding`

---

### T1.3 — SystemPromptExtractor (Anthropic)

**Satisfies:** FR-3, FR-24 (partial)
**Dependencies:** T1.2

Implement `src/proxy/extractor.ts` for Anthropic only (OpenAI in T1.21).
Handles `system` as string OR array of content blocks.

**Tests** (`tests/unit/extractor.test.ts`):

- Extract from `{ system: "string", messages: [...] }` → `{ provider: 'anthropic', system: "string", tools: [] }`
- Extract from `{ system: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], messages: [...] }` → system joined with `\n`
- Extract from request with `tools` array → tools normalized
- Missing `system` → `system: ""` (not error)
- Malformed body → `InvalidProviderError`

**Acceptance:**

- [ ] 5 unit tests pass
- [ ] Extractor is a pure function (no I/O, no async)
- [ ] All extracted text preserved verbatim (no normalisation, no trimming)

**RED commit:** `test(extractor): RED — Anthropic extractor handles string and content-block system`
**GREEN commit:** `feat(extractor): GREEN — Anthropic SystemPromptExtractor`

---

### T1.4 — BaselineStore (SQLite + AES-256-GCM)

**Satisfies:** FR-15, NFR-6, NFR-7
**Dependencies:** T1.1

Implement `src/baseline/store.ts` + `src/baseline/crypto.ts`. Schema from
`design.md` §4.1. CRUD: `upsertBaseline()`, `getBaseline(projectId,
provider)`, `recordAudit(...)`. All persisted prompt content encrypted.

**Tests** (`tests/unit/baseline-store.test.ts` + `tests/unit/crypto.test.ts`):

- AES-256-GCM round-trip (encrypt + decrypt) recovers plaintext exactly
- Different IVs produce different ciphertexts for same plaintext
- Tampered ciphertext fails decryption with `EncryptionError`
- `upsertBaseline` then `getBaseline` returns matching baseline
- Two projects with same `AGENTSEC_KEY` produce different stored ciphertexts (per-baseline salt)
- Inspecting the raw SQLite file after writing 10 baselines reveals NO plaintext substrings of the prompts (fuzz test)
- Missing `AGENTSEC_KEY` → `EncryptionError` on first write attempt

**Acceptance:**

- [ ] All 7 tests pass
- [ ] PBKDF2 iterations = 100,000
- [ ] No plaintext prompt content present in raw SQLite file (verified by binary substring search)

**RED commit:** `test(baseline): RED — BaselineStore must encrypt prompt content with AES-256-GCM`
**GREEN commit:** `feat(baseline): GREEN — BaselineStore with AES-256-GCM + PBKDF2`

---

### T1.5 — `agentsec approve` command

**Satisfies:** FR-4
**Dependencies:** T1.4, T1.3

Implement `src/cli/commands/approve.ts`. Queries the running proxy's
internal control endpoint for the most recently observed prompt, displays
it for confirmation, then writes a signed baseline.

**Tests:**

- E2E: start proxy, send 1 request, run `agentsec approve` non-interactively (--yes), assert baseline row exists with correct SHA-256
- Approve with no prior request → clear error: "No prompt observed yet"

**Acceptance:**

- [ ] Both tests pass
- [ ] Baseline ciphertext non-empty
- [ ] `audit_log` row written with `decision='rebaseline'`

**RED commit:** `test(cli): RED — agentsec approve must write a signed baseline`
**GREEN commit:** `feat(cli): GREEN — agentsec approve command`

---

### T1.6 — HashChangeDetector

**Satisfies:** FR-5, NFR-10
**Dependencies:** T1.4

Implement `src/detectors/hash.ts`. Pure function: SHA-256 of
`ctx.prompt.system` and compare to `ctx.baseline.promptHash`.

**Tests** (`tests/unit/detector-hash.test.ts`):

- Same prompt as baseline → `triggered: false`
- Different prompt → `triggered: true`, severity `warn`
- No baseline (null) → `triggered: false` (different concern; handled in pipeline)
- Whitespace-only difference → `triggered: true` (cryptographic, not semantic)

**Acceptance:**

- [ ] 4 unit tests pass
- [ ] Detector is synchronous, pure, no I/O

**RED commit:** `test(detector): RED — HashChangeDetector must trigger on any byte-level prompt change`
**GREEN commit:** `feat(detector): GREEN — HashChangeDetector`

---

### T1.7 — InjectionPatternDetector

**Satisfies:** FR-6
**Dependencies:** T1.4

Implement `src/detectors/injection.ts` + `src/detectors/injection-patterns.ts`.
Regex set frozen as module-level `const`. 15+ patterns.

**Tests:**

- "Ignore previous instructions" → triggered, evidence includes match
- "Ignore all previous instructions" → triggered (regex tolerates "all")
- Case-insensitive: "IGNORE PREVIOUS INSTRUCTIONS" → triggered
- Clean prompt with none of the patterns → not triggered
- Empty prompt → not triggered, no exception
- 1MB prompt, single match at end → triggered in < 5ms
- Stateful regex `g` flag: running detect() twice on same input yields same result (no `lastIndex` drift)

**Acceptance:**

- [ ] 7 tests pass
- [ ] All patterns compiled at module load (verified by importing the module and inspecting `typeof` of each pattern)
- [ ] Detector latency < 5ms on 1MB input

**RED commit:** `test(detector): RED — InjectionPatternDetector must match known override phrases`
**GREEN commit:** `feat(detector): GREEN — InjectionPatternDetector with frozen pattern set`

---

### T1.8 — ExfiltrationDetector

**Satisfies:** FR-7
**Dependencies:** T1.4

Implement `src/detectors/exfiltration.ts` + `exfiltration-patterns.ts`.
Patterns for `.ssh`, `.env`, `process.env`, `aws_secret_access_key`,
`/etc/passwd`, etc.

**Tests:** 6 positive + 2 negative + 1 perf, same shape as T1.7.

**RED commit:** `test(detector): RED — ExfiltrationDetector must match secret/env access patterns`
**GREEN commit:** `feat(detector): GREEN — ExfiltrationDetector`

---

### T1.9 — PermissionEscalationDetector

**Satisfies:** FR-8
**Dependencies:** T1.4

Implement `src/detectors/escalation.ts`. Set diff on tool names + JSON
schema diff on `inputSchema`.

**Tests:**

- Tools manifest unchanged → not triggered
- New tool name added → triggered
- Existing tool's `inputSchema` adds a new required parameter → triggered with `severity: high`
- Existing tool's description changed (only) → not triggered
- Tool removed → not triggered (removal is less suspicious than addition)
- 100-tool manifest diff completes in < 10ms

**RED commit:** `test(detector): RED — PermissionEscalationDetector must trigger on new tool or schema expansion`
**GREEN commit:** `feat(detector): GREEN — PermissionEscalationDetector`

---

### T1.10 — DriftAlertDetector

**Satisfies:** FR-9
**Dependencies:** T1.4

Implement `src/detectors/drift.ts`. Triggers when the prompt hash differs
from baseline AND `baseline.approvedAt` is older than the last 24h AND no
recent `agentsec approve` in audit log.

**Tests:**

- Prompt differs, no recent approve → triggered
- Prompt differs, approve in last hour → not triggered (already approved)
- Prompt identical to baseline → not triggered

**RED commit:** `test(detector): RED — DriftAlertDetector must distinguish unsigned change from re-approval`
**GREEN commit:** `feat(detector): GREEN — DriftAlertDetector`

---

### T1.11 — DetectionPipeline orchestrator

**Satisfies:** FR-3 (integration), NFR-10
**Dependencies:** T1.6 – T1.10

Implement `src/detectors/pipeline.ts`. Sketched in `design.md` §5.

**Tests** (`tests/unit/pipeline.test.ts`):

- All 5 detectors return `triggered: false` → `ThreatReport.triggered === false`
- 1 detector triggers `high`, 4 don't → `highestSeverity === 'high'`
- 1 detector throws → other 4 still produce results, throwing detector contributes `{ triggered: false, error: '...' }`, log written to `detector_errors.log` (NFR-10)
- Pipeline runs detectors in declared order (test by injecting order-sensitive mock)

**Acceptance:**

- [ ] 4 tests pass
- [ ] Throwing detector cannot abort pipeline

**RED commit:** `test(pipeline): RED — partial-failure isolation: one throwing detector must not abort others`
**GREEN commit:** `feat(pipeline): GREEN — DetectionPipeline with try/catch isolation per detector`

---

### T1.12 — QuarantineStateMachine

**Satisfies:** FR-10, NFR-9
**Dependencies:** T1.11

Implement `src/quarantine/state-machine.ts`. States from `design.md` §6.

**Tests:**

- `clean + triggered=false` → forward immediately
- `intercepted + sensitivity=permissive` → log + forward
- `intercepted + sensitivity=balanced + severity=info` → log + forward
- `intercepted + sensitivity=balanced + severity=warn` → quarantine
- `quarantined + user 'y'` → approved (no rebaseline)
- `quarantined + user 'a'` → approved + rebaseline=true
- `quarantined + user 'n'` → blocked
- `quarantined + timeout` → blocked (fail-secure)
- Timeout exact-deadline test: at exactly `deadline`, state is `blocked`, not `quarantined`

**Acceptance:**

- [ ] 9 tests pass
- [ ] No state transition from `quarantined` to `approved` without explicit user action OR future cloud-policy approval

**RED commit:** `test(quarantine): RED — quarantine timeout must fail-secure (block, never approve)`
**GREEN commit:** `feat(quarantine): GREEN — QuarantineStateMachine with fail-secure timeout`

---

### T1.13 — Terminal quarantine notifier

**Satisfies:** FR-11, FR-23, NFR-15
**Dependencies:** T1.12

Implement `src/quarantine/terminal-notifier.ts`. Uses `diff` package to render
unified diff. Reads single character from stdin via `readline` raw mode.

**Tests:**

- With TTY mock + stdin returning 'y' → state → approved
- With TTY mock + stdin returning 'a' → state → approved + rebaseline=true
- With TTY mock + stdin returning 'n' → state → blocked
- TTY=false (CI mode) → state → blocked immediately (no prompt rendered)
- Diff rendering produces unified-diff output (snapshot test)

**RED commit:** `test(quarantine): RED — terminal notifier must block immediately when no TTY (CI fail-secure)`
**GREEN commit:** `feat(quarantine): GREEN — terminal notifier with diff + y/n/a prompt + TTY check`

---

### T1.14 — `agentsec start` command

**Satisfies:** FR-12, NFR-7
**Dependencies:** T1.2

Implement `src/cli/commands/start.ts`. Validates `AGENTSEC_KEY` length,
starts the proxy, prints export instructions.

**Tests:**

- Missing `AGENTSEC_KEY` → exit code 78, stderr contains "AGENTSEC_KEY"
- Short `AGENTSEC_KEY` (< 32 chars) → exit code 78
- Valid env → proxy starts, stdout contains "listening on" + BASE_URL instructions

**RED commit:** `test(cli): RED — agentsec start must refuse to start when AGENTSEC_KEY is missing or short`
**GREEN commit:** `feat(cli): GREEN — agentsec start command with env validation`

---

### T1.15 — `agentsec log` + `agentsec status` commands

**Satisfies:** FR-13, FR-14
**Dependencies:** T1.4

Implement `src/cli/commands/log.ts` and `src/cli/commands/status.ts`.

**Tests:**

- `agentsec log` with 0 audit rows → empty table
- `agentsec log --limit 5` after writing 10 rows → exactly 5 most recent
- `agentsec log --json` → valid JSON Lines, one per row
- `agentsec status` → shows proxy state, baseline status, sensitivity, bypass

**RED commit:** `test(cli): RED — agentsec log must respect --limit and --json flags`
**GREEN commit:** `feat(cli): GREEN — agentsec log + status commands`

---

### T1.16 — First-run UX (HTTP 503 when no baseline)

**Satisfies:** FR-19
**Dependencies:** T1.2, T1.4

Wire up the proxy to check for baseline existence before forwarding.
Missing baseline → HTTP 503 with structured JSON.

**Tests:**

- Fresh DB (no baseline) + proxy request → HTTP 503
- Response body matches schema: `{ error: 'no_baseline', message: '...' }`
- After `agentsec approve`, subsequent request → forwards normally

**RED commit:** `test(proxy): RED — proxy must return 503 with setup instructions when no baseline exists`
**GREEN commit:** `feat(proxy): GREEN — first-run UX: HTTP 503 when no baseline`

---

### T1.17 — Sensitivity configuration

**Satisfies:** FR-20
**Dependencies:** T1.12

Implement `src/cli/commands/config.ts` with `--sensitivity` flag.
Persisted to `.agentsec/config.yaml` (CWD).

**Tests:**

- `agentsec config --sensitivity strict` → config file updated
- Invalid value → exit code 2 with clear error
- Running proxy reads sensitivity at startup; quarantine behaviour differs across strict/balanced/permissive (3 e2e tests)

**RED commit:** `test(cli): RED — sensitivity setting must control quarantine behaviour across strict/balanced/permissive`
**GREEN commit:** `feat(cli): GREEN — agentsec config --sensitivity`

---

### T1.18 — Bypass + exempt commands

**Satisfies:** FR-21, FR-22
**Dependencies:** T1.4

Implement `src/cli/commands/bypass.ts` + `src/cli/commands/exempt.ts`.

**Tests:**

- `agentsec bypass --minutes 30` → bypass row in DB; next request bypasses quarantine
- Bypass with N > 120 → exit code 2
- Bypass expires automatically after window
- `agentsec exempt --pattern "X"` → encrypted exempt row; matching prompt no longer triggers Injection/Drift
- Exempt patterns are encrypted in raw SQLite (substring fuzz check)

**RED commit:** `test(cli): RED — bypass must auto-expire and exempt patterns must be encrypted at rest`
**GREEN commit:** `feat(cli): GREEN — bypass + exempt commands`

---

### T1.19 — End-to-end integration test

**Satisfies:** NFR-11 (cross-cutting)
**Dependencies:** T1.1 – T1.18

One real e2e test: spawn the `agentsec` CLI as a subprocess, start a real
fake-upstream Fastify server, send a real HTTP request through the proxy
that triggers InjectionPatternDetector, simulate `y` keystroke on stdin,
assert request forwarded and audit log row written.

**RED commit:** `test(e2e): RED — full quarantine cycle: detect → terminal prompt → approve → forward`
**GREEN commit:** `test(e2e): GREEN — wire up e2e test harness for spawn + assert`

---

### T1.20 — OpenAI provider support

**Satisfies:** FR-24
**Dependencies:** T1.3

Add OpenAI extraction to `src/proxy/extractor.ts`. Route
`/v1/chat/completions` to OpenAI extractor.

**Tests:**

- OpenAI request with `messages: [{ role: 'system', text: '...' }, ...]` → NormalizedPrompt
- OpenAI request with `tools: [{ type: 'function', function: {...} }]` → tool descriptors normalized
- Mixed provider routes — `/v1/messages` returns Anthropic, `/v1/chat/completions` returns OpenAI
- All 5 detectors run against OpenAI-extracted prompts (parametrised tests)

**RED commit:** `test(extractor): RED — OpenAI request body must extract system + tools`
**GREEN commit:** `feat(extractor): GREEN — OpenAI extraction with provider routing`

---

### T1.21 — CloudSync (opt-in, metadata only)

**Satisfies:** FR-16, NFR-8
**Dependencies:** T1.4

Implement `src/cloud/sync.ts`. POSTs allow-listed metadata only.

**Tests:**

- Disabled by default — zero outbound HTTP attempts
- Enabled — POST contains ONLY the 7 allow-listed fields from FR-16
- Fuzz: include arbitrary extra fields in audit row → none appear in POST body
- API down → enqueue to `cloud_sync_queue`, retry next cycle
- Two-step opt-in: API key set but `--enable-cloud-sync` not run → still disabled

**Acceptance:**

- [ ] Serializer is allow-list based (assert by reading source)
- [ ] Test that fuzzes random keys into audit row asserts none reach the wire

**RED commit:** `test(cloud): RED — cloud sync must send ONLY allow-listed fields, never raw prompt content`
**GREEN commit:** `feat(cloud): GREEN — CloudSync with allow-list serializer + retry queue`

---

### T1.22 — Pro-tier webhook

**Satisfies:** FR-18
**Dependencies:** T1.21

Implement webhook delivery in `src/cloud/sync.ts` (or split module if needed).

**Tests:**

- Webhook configured → quarantine event POSTed to webhook URL
- HMAC-SHA256 signature header present and verifiable
- Telegram / Slack / generic format selection works
- Webhook DOWN does not block quarantine UX

**RED commit:** `test(cloud): RED — webhook must include HMAC signature and not block quarantine on failure`
**GREEN commit:** `feat(cloud): GREEN — webhook delivery with HMAC + non-blocking retry`

---

### T1.23 — Log scrubber (secrets-out-of-logs)

**Satisfies:** NFR-14
**Dependencies:** T1.1

Implement `src/proxy/log-scrubber.ts`. Pino serializer that redacts
`authorization`, `api-key`, `x-api-key`, and `sk-[A-Za-z0-9]{20,}` patterns.

**Tests:**

- Pino log with `authorization: 'Bearer ...'` header → `authorization: '[REDACTED]'`
- Log payload with embedded `sk-abc...` string → redacted
- Fuzz: generate 100 random log payloads containing secrets → none survive
- Logger receives full prompt text → never written (separate test asserts on stdout capture)

**RED commit:** `test(proxy): RED — log scrubber must redact authorization headers and sk- key patterns`
**GREEN commit:** `feat(proxy): GREEN — pino log scrubber for secrets`

---

### T1.24 — NFR-13 CI enforcement script

**Satisfies:** NFR-13
**Dependencies:** T1.1

Implement `scripts/check-no-llm-calls.ts`. Greps `src/detectors/`,
`src/quarantine/`, `src/baseline/` for prohibited strings. Exits non-zero
on match.

**Tests:**

- Run script on clean tree → exit 0
- Inject `anthropic.com` string into `src/detectors/injection.ts` → exit non-zero with clear message
- String inside a comment also fails (no exemption for comments — comments can be stripped from prod builds; the rule is absolute)
- Script itself is invoked in CI workflow

**RED commit:** `test(infra): RED — CI must fail if anthropic.com or openai.com appears in detection modules`
**GREEN commit:** `feat(infra): GREEN — check-no-llm-calls.ts CI enforcement for NFR-13`

---

### T1.25 — Traceability check script

**Satisfies:** (process-level)
**Dependencies:** T1.1

Implement `scripts/check-traceability.ts`. Parses every `FR-XX` / `NFR-XX`
from `requirements.md`. Parses every `Satisfies:` line from `tasks.md`.
Fails if any requirement is not satisfied by any task.

**Tests:**

- All current FRs/NFRs are covered → exit 0
- Add a fake FR to requirements.md → exit non-zero listing the orphan

**RED commit:** `test(infra): RED — traceability script must detect uncovered requirements`
**GREEN commit:** `feat(infra): GREEN — check-traceability.ts CI gate`

---

## Phase 1 — Docs Sync (Mandatory, per docs-freshness standing order)

Before the final regression-and-push commit:

| File to update                      | What                                                             |
| ----------------------------------- | ---------------------------------------------------------------- |
| `README.md`                         | Add full command reference, demo asciinema, install instructions |
| `.env.example`                      | Final list of all `AGENTSEC_*` variables                         |
| `.agentsec/config.yaml.example`     | Final list of all YAML config fields                             |
| `CHANGELOG.md`                      | Document 0.1.0 initial release                                   |
| `.github/copilot-instructions.md`   | Verify Key Files table matches actual `src/` layout              |
| `docs/agent_sec_specs/openapi.yaml` | Verify cloud endpoints match Pro-tier implementation             |
| `docs/agent_sec_specs/design.md`    | Update "Open design questions" if any resolved during build      |

**Commit:** `docs(phase1): sync docs to shipped 0.1.0 surface`

---

## Regression and Release

After all 25 tasks complete + docs sync:

1. `npx vitest run` — zero failures
2. `npm run lint` — zero errors
3. `scripts/check-no-llm-calls.ts` — pass
4. `scripts/check-traceability.ts` — pass
5. `npm pack` — inspect tarball contents
6. Tag `v0.1.0` + push
7. `npm publish --access public`
8. Public repo flip + HN Show HN + X/Twitter launch thread

---

## Out of Scope (Phase 2)

See `requirements.md` § "Out of Scope for Phase 1".
