# AgentSec — Requirements (Phase 1)

Numbered functional (FR-XX) and non-functional (NFR-XX) requirements.
Same format and rigor as `docs/phase_1/requirements.md` in the parent
market-scout project.

**Acceptance rule:** every FR and NFR maps to at least one test in `tasks.md`.
Requirements without tests are incomplete and must not be considered shipped.

---

## Functional Requirements

### Proxy Core

**FR-1 — Local HTTP proxy intercepts LLM API requests.**
AgentSec runs a Fastify HTTP server on port 7777 (configurable via `AGENTSEC_PORT`).
It accepts `POST /v1/messages` (Anthropic API format) and
`POST /v1/chat/completions` (OpenAI API format). Other paths return HTTP 404.

**FR-2 — Proxy transparently forwards clean requests and streams responses.**
For requests that pass all detectors and have an approved baseline, the proxy
forwards the request body unchanged to the upstream API and streams the
response (including SSE chunks for streaming responses) back to the caller
via `stream.pipeline()` without buffering the full response body in memory.

**FR-3 — System prompt and tool manifest extracted from request body.**
The `SystemPromptExtractor` parses the request body according to the
provider format:

- Anthropic: `system` field (string or array of content blocks) + `tools` array
- OpenAI: messages with `role: "system"` + `tools` array
  It produces a `NormalizedPrompt { system: string, tools: ToolDescriptor[], provider: 'anthropic'|'openai' }`.

### Baseline Lifecycle

**FR-4 — `agentsec approve` signs and stores an encrypted baseline.**
The command issues a request to the running proxy's internal control endpoint
to capture the most recently observed system prompt for the current project,
hashes it with SHA-256, encrypts it with AES-256-GCM, and stores it in the
local SQLite baseline store. Subsequent detection runs compare against this
signed baseline.

### Detectors (5 deterministic)

**FR-5 — HashChangeDetector.**
Computes SHA-256 of the current normalized system prompt. Compares against the
stored baseline hash. Triggers when hashes differ.

**FR-6 — InjectionPatternDetector.**
Matches the current prompt against a built-in set of compiled regex patterns
known to indicate prompt injection (case-insensitive, examples):
`/ignore (all )?previous instructions/i`,
`/disregard your system prompt/i`,
`/you are now (?:in )?developer mode/i`,
`/forget everything above/i`,
plus 15+ additional patterns shipped in `src/detectors/injection-patterns.ts`.
Pattern set is statically compiled at module load.

**FR-7 — ExfiltrationDetector.**
Matches against patterns indicating secret / env / credential access:
`/process\.env\b/`, `/\.ssh\/(?:id_rsa|id_ed25519|authorized_keys)/`,
`/\/etc\/(passwd|shadow)/`, `/aws_(secret_)?access_key/i`,
`/\.env(\.local|\.production)?/`, etc.

**FR-8 — PermissionEscalationDetector.**
Compares the `tools` array in the current prompt against the approved tool
manifest stored alongside the baseline. Triggers when:

- A new tool name appears that was not in the approved manifest, OR
- An existing tool's input schema has materially changed (added required
  parameters of types `string` accepting shell-like patterns)
  Uses set diff and JSON schema diff; both O(n + m).

**FR-9 — DriftAlertDetector.**
Triggers when the current request differs from the approved baseline AND no
`agentsec approve` has been run since the last baseline was signed. This is
distinct from FR-5 (HashChange) in that it ALSO checks the audit-log of
approvals — a HashChange that immediately follows an approval is not a drift
event.

### Quarantine

**FR-10 — Quarantine state machine.**
States: `clean → intercepted → quarantined → (approved | blocked | timeout)`.
Default timeout 60 seconds, configurable via `AGENTSEC_QUARANTINE_TIMEOUT_SEC`,
maximum 600 seconds. On `timeout` the state transitions to `blocked` (fail-secure).

**FR-11 — Terminal quarantine notifier.**
When quarantined, the proxy renders a unified diff of the current prompt
versus the baseline to the controlling terminal via the `diff` npm package.
Prompts on stdin: `[y] approve once  [n] block  [a] approve + rebaseline`.
If no TTY is attached (CI / headless), the quarantine timer runs immediately
and the request is blocked at timeout (see NFR-15).

### CLI Commands

**FR-12 — `agentsec start`.**
Starts the proxy. Prints to stdout:

```
AgentSec listening on http://localhost:7777
Configure your AI agent to use this proxy:
  export ANTHROPIC_BASE_URL=http://localhost:7777
  export OPENAI_BASE_URL=http://localhost:7777/v1
```

Exits with non-zero status if `AGENTSEC_KEY` is missing or invalid.

**FR-13 — `agentsec log`.**
Shows the last N detection events (default 20, `--limit N` override).
Columns: timestamp, provider, project_id, detector(s) triggered, decision.
Output is human-readable table by default, `--json` for JSON Lines.

**FR-14 — `agentsec status`.**
Shows:

- Proxy state (running / not running, port)
- Current project_id (CWD hash)
- Baseline status (signed / unsigned, last approved timestamp)
- Active sensitivity setting
- Active bypass (if any) and time remaining
- Cloud sync status (enabled / disabled)
- Detector count loaded

### Data Privacy

**FR-15 — All prompt content encrypted at rest.**
Every baseline write to SQLite encrypts the prompt content with AES-256-GCM
using a key derived from `AGENTSEC_KEY` via PBKDF2 (100,000 iterations,
SHA-256, project-specific salt). Plaintext prompt content is never written
to disk.

**FR-16 — Cloud sync data minimisation.**
When cloud sync is enabled (Pro/Team only, opt-in), the only fields sent to
the AgentSec cloud API are:

- `timestamp` (ISO 8601)
- `project_id` (SHA-256 hash of CWD)
- `provider` (anthropic | openai)
- `detector_name` (which detector triggered)
- `decision` (approved | blocked | timeout | bypass | exempt)
- `prompt_hash` (SHA-256, lowercase hex)
- `severity` (info | warn | high)

The list above is exhaustive. **No raw prompt content, no tool descriptors,
no request bodies, no API keys, no Authorization headers are EVER sent.**
The serializer in `src/cloud/sync.ts` is allow-list based — any field not
in the list is omitted.

### Pro-Tier Features

**FR-17 — Pro-tier policy pull.**
When `AGENTSEC_CLOUD_API_KEY` is set, the proxy fetches the active policy
(additional regex rule sets) from the cloud API on startup and refreshes
every 15 minutes. Cloud-pulled rules are ADDITIVE — they cannot disable
built-in detectors.

**FR-18 — Pro-tier quarantine webhook.**
When a webhook URL is configured (`AGENTSEC_WEBHOOK_URL`), every quarantine
event posts the metadata payload from FR-16 to the URL using HMAC-SHA256
signing. Telegram and Slack webhook payload formats are supported via
`AGENTSEC_WEBHOOK_FORMAT=telegram|slack|generic`.

### Round 5 — UX & First-Run

**FR-19 — Fail-secure first run.**
When no baseline exists for the current project, the proxy returns HTTP 503
with a JSON body: `{ "error": "no_baseline", "message": "No baseline has been
approved for this project. Run 'agentsec approve' to inspect and sign the
current system prompt." }`. The terminal where `agentsec start` is running
also prints this message.

**FR-20 — Sensitivity setting.**
`agentsec config --sensitivity <strict|balanced|permissive>`.

- `strict` — any detector hit → quarantine
- `balanced` — `severity >= warn` quarantines; `info` events are logged only (DEFAULT)
- `permissive` — all events logged; never quarantines

**FR-21 — Temporary bypass.**
`agentsec bypass --minutes N` suppresses quarantine for N minutes.
Maximum N is 120 (2 hours). Every bypassed event is still written to the audit
log with `decision: "bypass"` and the bypass duration. Bypass expires
automatically.

**FR-22 — Pattern allowlist (exempt).**
`agentsec exempt --pattern "<string>"` adds a literal string to a per-project
allowlist. Prompts containing the exempt pattern bypass the
InjectionPatternDetector and DriftAlertDetector for that specific substring
only. The exempt list is stored encrypted alongside the baseline.

**FR-23 — One-click rebaseline in quarantine prompt.**
The terminal quarantine prompt offers three options: `[y]` approve this one
request only, `[n]` block, `[a]` approve AND set the current prompt as the
new signed baseline. The `[a]` path is equivalent to "approve once then run
`agentsec approve`" but in a single keystroke.

### Multi-Provider + Licensing

**FR-24 — Anthropic and OpenAI both supported in Phase 1.**
The `SystemPromptExtractor` auto-detects the provider from the request path
(`/v1/messages` → anthropic, `/v1/chat/completions` → openai) and uses the
matching extraction logic. The detection pipeline operates on the normalized
`NormalizedPrompt` regardless of provider.

**FR-25 — Apache 2.0 license; OSS-first GTM.**
The repository at `github.com/agentsec/agentsec` is published under the
Apache License 2.0. The Pro/Team hosted tier is a separate closed-source
service deployed at `agentsec.dev/api`. OSS launch precedes Pro/Team launch
by 4–8 weeks.

---

## Non-Functional Requirements

**NFR-1 — Latency overhead.**
Median proxy overhead for a clean request (baseline present, no triggers)
must be < 50ms (P50), < 150ms (P99), measured against a localhost
fake-upstream. Detection pipeline itself completes in < 20ms median.

**NFR-2 — Zero LLM API calls by AgentSec.**
AgentSec itself makes zero outbound calls to any LLM API for the purpose of
detection, analysis, or rule evaluation. (See also NFR-13.)

**NFR-3 — Local-only mode works offline.**
With cloud sync disabled (default), the proxy operates fully without network
access except for forwarding the developer's own LLM calls to the upstream
API. Air-gapped use is supported.

**NFR-4 — Streaming response handling.**
The proxy handles upstream SSE streaming responses without buffering the full
response body. Memory usage during a streaming response does not grow linearly
with response size.

**NFR-5 — Simple installation.**
`npm install -g agentsec` (or `pnpm add -g agentsec`) suffices. Zero system
dependencies. The single binary distribution (Phase 1.1) bundles Node.js so
non-Node users can install without prior Node setup.

**NFR-6 — No plaintext prompt content on disk.**
No code path in AgentSec writes raw prompt content to disk without
AES-256-GCM encryption first. Verified by a test that fuzzes the BaselineStore
and inspects the on-disk SQLite file for plaintext substrings.

**NFR-7 — Required encryption key.**
`AGENTSEC_KEY` must be set and ≥ 32 characters. The process refuses to start
otherwise, exiting with status 78 (EX_CONFIG) and a clear error message.
The key is never logged.

**NFR-8 — Cloud sync is opt-in.**
Cloud sync is disabled by default. Enabling it requires explicitly setting
`AGENTSEC_CLOUD_API_KEY` AND running `agentsec config --enable-cloud-sync`
(two-step opt-in).

**NFR-9 — Quarantine timeout fails secure.**
If the developer does not respond to a quarantine prompt within the timeout,
the request is **blocked** (HTTP 403 to caller). Never approved. Never
forwarded. Audit log records `decision: "timeout"`.

**NFR-10 — Detector partial-failure isolation.**
If one detector throws an exception, the remaining detectors still run and
the ThreatReport aggregates all results. Test by injecting `throw new Error()`
into one detector and asserting the other four still produce results AND
that the throwing detector's failure is logged.

**NFR-11 — Test coverage discipline.**
Each detector has at least 4 unit tests (positive, negative, edge,
adversarial) AND one end-to-end integration test that drives through the
real proxy with a real fake-upstream server.

**NFR-12 — License + OSS posture.**
Apache 2.0 license on the OSS repo. Hosted tier code is a separate
closed-source repository. No GPL/AGPL/SSPL dependencies allowed in OSS repo.
`license-checker-rseidelsohn` runs in CI.

**NFR-13 — Trust boundary (NON-NEGOTIABLE).**
The trust boundary of AgentSec is cryptographic and deterministic.
No component of the detection pipeline shall make an external LLM API call.
Detection logic must produce the same output for the same input, every time,
with no probabilistic elements.
_Local offline ML embeddings are permitted in Phase 2 only as an opt-in
layer on top of deterministic rules, never as a replacement._
**Enforced by a CI grep that fails the build if `anthropic.com`, `openai.com`,
`/v1/messages`, or `/v1/chat/completions` strings appear outside `src/proxy/`
and `src/cloud/`.**

**NFR-14 — Secrets never logged.**
The `Authorization` HTTP header, API key values, raw prompt content, and
encryption key bytes are never written to any log at any level.
Log scrubber middleware redacts these fields globally; a test fuzzes log
output with secret-shaped strings and asserts none survive.

**NFR-15 — Headless / CI fail-secure.**
When `process.stdout.isTTY === false`, quarantine prompts are not rendered
to stdin. The quarantine timer runs immediately and the request blocks on
timeout. Operators running AgentSec in CI must set
`AGENTSEC_SENSITIVITY=permissive` (log-only) or be prepared for blocks.
The behaviour is documented in `deployment.md`.

**NFR-16 — Project identity derivation.**
The default `project_id` is `SHA-256(absolute CWD)`, truncated to 16 hex
chars. Overridable via `AGENTSEC_PROJECT` env var or
`.agentsec/config.yaml` → `project: my-project-name`. The override is
hashed the same way so cloud sync never sees the raw project name.

---

## Requirement-to-Test Traceability

Every requirement above MUST appear in the acceptance criteria of at least
one task in `tasks.md`. Reverse direction: every task in `tasks.md` MUST
cite the FR/NFR numbers it satisfies. CI enforces this with a script in
`scripts/check-traceability.ts`.

---

## Out of Scope for Phase 1 (Deferred to Phase 2+)

- MCP tool-call inspection beyond the static `tools` manifest (Phase 2)
- Shell-command dry-run guardrails (Phase 2)
- GitHub Actions YAML pinning (Phase 2)
- Hosted dashboard UI (Phase 2)
- Team / org features (Phase 2)
- Rules marketplace (Phase 2+)
- TLS interception via local CA (Phase 2)
- Windows support (Phase 2+)
- Local offline ML embedding model for semantic drift (Phase 2, opt-in)
