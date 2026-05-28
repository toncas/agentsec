# Copilot Instructions — AgentSec

## Project Overview

**AgentSec** is an open-source TypeScript CLI tool and local-first transparent
HTTP proxy that monitors **system-prompt integrity** for AI coding agents
(Claude Code, Cursor, Cline, OpenAI Codex, or any agent whose SDK respects a
configurable `BASE_URL`). It sits between the agent and the upstream LLM API
(Anthropic / OpenAI in Phase 1), intercepts every request, and runs a
**deterministic, cryptographic** detection pipeline against the prompt. If a
threat is detected the request is **quarantined** — paused while the developer
reviews a unified diff in the terminal and approves or denies.

AgentSec's value proposition is precisely that **it is not an AI**. It is a
deterministic, cryptographic sentinel. The market has spoken on this twice
already: every AI-based prompt-injection detector (Rebuff, Azure Prompt Shield)
has the same circular-trust problem — _who watches the watchman?_ AgentSec
exists to be the trust anchor, not another probabilistic judge.

---

## The Non-Negotiable Rule (NFR-13)

> **TRUST BOUNDARY.** No component in the detection pipeline
> (`src/detectors/`, `src/proxy/`, `src/baseline/`, `src/quarantine/`) shall
> make an outbound HTTP request to any LLM API. Detection is cryptographic
> and rule-based. This is **not a performance constraint** — it is a
> **correctness constraint**. Violating this rule makes the tool untrustworthy
> by design. If a feature seems to require an LLM call inside those modules,
> **stop and raise it as a blocker** — do not work around it.

The only locations where LLM calls are permitted are:

- Documentation generation (one-off, manual)
- Phase 2 _optional_ local-offline embedding model for semantic drift detection
  (`@xenova/transformers` running entirely on-device — **never** an external API)

---

## Architecture Map

```
AI Agent  (Claude Code / Cursor / Cline / OpenAI Codex / any BASE_URL-respecting SDK)
    │   ANTHROPIC_BASE_URL=http://localhost:7777
    │   OPENAI_BASE_URL=http://localhost:7777/v1
    ▼
AgentSec Local Proxy  (Fastify, port 7777, Node.js, single binary preferred)
    │
    ├── src/proxy/server.ts            — Fastify server; routes POST /v1/messages and /v1/chat/completions
    ├── src/proxy/extractor.ts         — SystemPromptExtractor; provider-aware (Anthropic + OpenAI)
    │
    ├── src/detectors/pipeline.ts      — DetectionPipeline; runs Detector[] in sequence → ThreatReport
    ├── src/detectors/hash.ts          — HashChangeDetector            (SHA-256 vs baseline)
    ├── src/detectors/injection.ts     — InjectionPatternDetector      (compiled regex set)
    ├── src/detectors/exfiltration.ts  — ExfiltrationDetector          (env/secret access patterns)
    ├── src/detectors/escalation.ts    — PermissionEscalationDetector  (tool list diff)
    ├── src/detectors/drift.ts         — DriftAlertDetector            (unsigned change since approve)
    │
    ├── src/quarantine/state-machine.ts — clean → intercepted → quarantined → (approved | blocked | timeout)
    ├── src/quarantine/terminal-notifier.ts — diff renderer + y/n/a CLI prompt; TTY-aware
    │
    ├── src/baseline/store.ts          — BaselineStore; better-sqlite3 + AES-256-GCM; PBKDF2 key derivation
    │
    ├── src/proxy/forwarder.ts         — Upstream forwarder; SSE stream pipe; never buffers full body
    │
    ├── src/cli/commands/              — Commander.js: start, approve, log, status, config, bypass, exempt
    │
    ├── src/cloud/sync.ts              — CloudSync (Pro/Team, opt-in); metadata + hash only, NEVER raw content
    │
    └── src/config.ts                  — Config loader; env vars + .agentsec/config.yaml; validates AGENTSEC_KEY
    ▼
Upstream LLM API  (api.anthropic.com / api.openai.com — the real endpoint)
```

### Key Files Reference

| File                                                              | Role                                                                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------ |
| `src/proxy/server.ts`                                             | Fastify HTTP server on port 7777. Routes `POST /v1/messages` (Anthropic) and `POST /v1/chat/completions` (OpenAI). Owns request lifecycle.                               |
| `src/proxy/extractor.ts`                                          | Pure function. Parses request body into a `NormalizedPrompt` (system text + tool manifest + provider tag). Provider auto-detected from path.                             |
| `src/proxy/forwarder.ts`                                          | Forwards approved requests to the real upstream API. Uses Node.js `stream.pipeline()` for SSE responses; never accumulates the full response body.                       |
| `src/detectors/pipeline.ts`                                       | Orchestrator. Runs all `Detector[]` in sequence, aggregates results into `ThreatReport { triggered: boolean, hits: DetectorResult[] }`. Partial-failure isolated.        |
| `src/detectors/{hash,injection,exfiltration,escalation,drift}.ts` | The 5 deterministic detectors. Each implements `Detector { name: string; detect(ctx: DetectionContext): DetectorResult }`. Pure, no I/O, no LLM calls.                   |
| `src/quarantine/state-machine.ts`                                 | Stateful per-request. Transitions: `clean → intercepted → quarantined → (approved                                                                                        | blocked | timeout)`. Timeout default 60s, configurable, fail-secure (timeout → blocked). |
| `src/quarantine/terminal-notifier.ts`                             | Renders unified diff via the `diff` npm package, prompts on stdin. If no TTY (CI), auto-blocks after timeout.                                                            |
| `src/baseline/store.ts`                                           | `better-sqlite3`. AES-256-GCM with `crypto.createCipheriv`. PBKDF2 100,000 iterations, SHA-256, project-specific salt. Encryption key derived from `AGENTSEC_KEY`.       |
| `src/cli/commands/start.ts`                                       | `agentsec start` — starts proxy, prints `export ANTHROPIC_BASE_URL=...` instructions.                                                                                    |
| `src/cli/commands/approve.ts`                                     | `agentsec approve` — captures current prompt, signs it, stores as baseline.                                                                                              |
| `src/cli/commands/log.ts`                                         | `agentsec log` — recent detections + decisions.                                                                                                                          |
| `src/cli/commands/status.ts`                                      | `agentsec status` — proxy state, baseline info, active rules.                                                                                                            |
| `src/cli/commands/config.ts`                                      | `agentsec config --sensitivity strict\|balanced\|permissive`.                                                                                                            |
| `src/cli/commands/bypass.ts`                                      | `agentsec bypass --minutes N` — timed quarantine suppression (audit-logged).                                                                                             |
| `src/cli/commands/exempt.ts`                                      | `agentsec exempt --pattern PATTERN` — allowlist a string pattern.                                                                                                        |
| `src/cloud/sync.ts`                                               | Pro/Team only. Posts encrypted metadata to AgentSec cloud. **Sends:** timestamp, project_id, detection_type, decision, prompt hash. **Never sends:** raw prompt content. |
| `src/config.ts`                                                   | Loads env vars + `.agentsec/config.yaml`. Validates `AGENTSEC_KEY` length ≥ 32 chars at startup; process refuses to start otherwise.                                     |
| `src/types.ts`                                                    | All shared types: `NormalizedPrompt`, `DetectionContext`, `DetectorResult`, `ThreatReport`, `Baseline`, `QuarantineState`. No inline type defs in feature modules.       |

---

## TDD Standing Order — Mandatory for Every Fix, Feature, or Bug

Follow this exact sequence without exception:

1. Write the failing test first, run it, **confirm it fails**
2. Commit: `test(<scope>): RED — <description>`
3. Apply the minimal implementation to make tests pass
4. Run the **full regression suite** to confirm zero regressions
5. Commit: `fix(<scope>): GREEN — <description>` (or `feat(...)`)

### Regression Command

```bash
npx vitest run
```

### Rules

- Never skip the regression step — even for "obvious" fixes
- Never batch RED + GREEN into one commit
- Commit message prefix: `test(...)` for RED, `fix(...)`/`feat(...)` for GREEN
- If regression finds failures unrelated to the current task, **note them but
  do not fix them in the same PR** — open a separate task

### Scope Keywords

`proxy`, `extractor`, `forwarder`, `detector`, `pipeline`, `quarantine`,
`baseline`, `cli`, `cloud`, `config`, `sync`

---

## Docs-Freshness Standing Order

Docs going stale is a recurring bug. Every sprint plan MUST include an explicit
docs-sync step before the final push. Treat docs as a first-class deliverable.

| Change                            | Docs to update                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| New CLI subcommand                | `README.md` commands table, `.github/copilot-instructions.md` Key Files                                                  |
| New detector                      | `requirements.md` (new FR-XX), `design.md` detector list, `.github/copilot-instructions.md` Key Files + Architecture Map |
| New env var                       | `.env.example`, `README.md` env vars table, `src/config.ts` validator                                                    |
| New API endpoint (cloud)          | `openapi.yaml`, `design.md` API section                                                                                  |
| New `.agentsec/config.yaml` field | `src/config.ts`, `.agentsec/config.yaml.example`, `README.md`                                                            |
| New scheduler/timer (Phase 2+)    | `.github/copilot-instructions.md` Scheduler Cadence (when added)                                                         |
| Every sprint ships new features   | `CHANGELOG.md` — add a `## [Sprint N] — YYYY-MM-DD` section listing features, fixed blockers, and breaking changes        |

Commit prefix for doc-only changes: `docs(<scope>): <description>`.

---

## Sprint Closeout Gate — Mandatory Pre-Push Checklist

Before any sprint pushes to `origin/main`, every item below must be true:

- [ ] `npx vitest run` passes locally (zero failures)
- [ ] `npm run check:nollm` exits 0
- [ ] `npm run check:trace` exits 0
- [ ] `npm run lint` exits 0 (zero warnings)
- [ ] `npx license-checker-rseidelsohn --production --onlyAllow "MIT;Apache-2.0;ISC;BSD-2-Clause;BSD-3-Clause;0BSD;CC0-1.0;Python-2.0;BlueOak-1.0.0"` exits 0
- [ ] Every step in `.github/workflows/ci.yml` maps to a real `npm run <script>` or an installed devDep binary (no undefined scripts, no bare `npx X` where X is not in devDependencies)
- [ ] Every sprint dep added this sprint is listed in `package.json` (not just present in `node_modules`)
- [ ] `docs/tasks.md` — all finished tasks have `[x]` acceptance boxes; unfinished or blocked criteria use `[~] <criterion> (blocked by: <reason>; tracked in issue #N)`
- [ ] `CHANGELOG.md` — sprint entry committed
- [ ] At least one `docs(<scope>): ...` commit exists in the sprint's commits

Closeout commit format: `docs(sprint-N): closeout — tasks.md + CHANGELOG + docs sync`

---

## Package & CI Integrity Standing Order

All runtime and development dependencies for a sprint must be added to
`package.json` **during T1.1 (scaffolding)** or **as the very first act of the
sprint task that introduces them**, before the RED commit that first imports them.

- Every `npm run X` in `.github/workflows/ci.yml` must map to a script in
  `package.json`. A ci.yml that references an undefined script is a
  build-breaking bug with the same severity as a failing test.
- Every `npx X` in `.github/workflows/ci.yml` must correspond to a pinned
  devDependency. Never run bare `npx X` for a tool that is not in `devDependencies`
  — non-reproducible and network-dependent on CI runners.
- ESLint must be configured from **T1.1**:
  - devDeps: `eslint@^9`, `typescript-eslint@^8`
  - config file: `eslint.config.mjs` using flat-config format
  - script: `"lint": "eslint src/ tests/ scripts/ --max-warnings 0"`
- `src/config.ts` is **T1.1 scope**, not T1.14. AGENTSEC_KEY validation (NFR-7)
  must be in place before any proxy test. A proxy that starts with no key
  violates the trust model from the first commit.

---

## TDD Heuristics

These are standing quality gates for every test in this codebase.

**1. Test the contract at the boundary you actually rely on, not the one your test happens to reach.**
Test that the proxy returned HTTP 503; not that `BaselineStore.get()` returned null. Test that a row was written to the `audit_log` table; not that `auditLogger.write()` was called.

**2. List the threads, processes, and event loops your code crosses, and put a test on each crossing.**
Fastify runs request handlers on the Node.js event loop. Detectors are synchronous pure functions. SQLite (better-sqlite3) is synchronous but issues file I/O. The terminal notifier reads stdin asynchronously. If your test drives a handler function directly instead of going through the real Fastify request lifecycle, you have skipped a crossing.

**3. Treat "primitive choice" as a test surface, not an implementation detail.**
A regex compiled inside a request handler has different perf and correctness characteristics from one compiled at module load. A `Map` and an `Object` literal have different prototype-pollution surfaces. When the primitive matters, write a test whose pass/fail flips when someone swaps it out.

**4. Avoid synchronous shortcuts when you're testing asynchronous behavior.**
`setImmediate()`, `setTimeout(0)`, `Promise.resolve().then(...)` and similar tricks collapse the timing model production code lives under. Useful for unit tests of pure logic. Dangerous for testing routing, ordering, or stream backpressure. Run at least one test through the actual Fastify server with the real upstream-mock server and the real stream pipe.

**5. Distrust mocks at framework boundaries.**
When Fastify, better-sqlite3, or Node's `crypto` module controls execution, mocking out their interface tells you about your code only — never about the integration. Pair `vi.mock()` unit tests with at least one **real-Fastify + fake-upstream-server** integration test per critical proxy flow.

**6. Read the framework source for the API you're integrating with.**
When you're choosing a primitive to thread state through Fastify (request decorators, hooks, plugins) — look at where Fastify actually executes your callback. The docs are not enough; the question "which request lifecycle phase is my code in?" almost always needs a glance at the source.

**7. For warm/long-lived/singleton resources, stress them across simulated cold→warm→warm transitions.**
The proxy is long-lived. Baseline caching, detector regex compilation, SQLite prepared statements, and cloud sync deduplication only surface bugs on the second or Nth use. A "two sequential proxy requests" test pattern catches a disproportionate share of these. **Every proxy integration test should send at least two requests.**

**8. When a test passes "too easily," interrogate it.**
If the assertion holds on the very first run with no surprises, ask: what would have to change in production for this test to fail? If you can't articulate at least one realistic break — wrong baseline scope, wrong project_id derivation, wrong stream chunk order — the test isn't really verifying the contract.

**9. Measure the gap between the test and the production code path.**
How many functions/classes does the test instantiate that production never touches (mocks, fakes, helpers)? How many that production touches does the test bypass (real Fastify, real SQLite, real crypto)? The smaller both deltas, the higher the confidence.

**10. Convert review feedback into permanent contracts.**
When a reviewer points out a class of bug your tests missed (cross-request state leak, stream-buffering memory growth, baseline race condition), don't just patch — write the test that would have caught it. The next reviewer reading this code will see the contracts you actually care about.

---

## Antifragile Development Principles

Antifragile means the system improves under stress — not just survives it.

- **Every failure mode is observable.** Detection counts logged per request
  (passed / blocked / quarantined / bypassed / exempt). Audit log persisted to
  SQLite. Cloud sync failures persisted to `sync_failures.log`. Quarantine
  timeouts logged with project_id and detector_name. If a failure can't be
  observed in logs or DB, it's a bug in the observability — not just the
  feature.

- **Partial failure isolation is a hard contract.** One failing detector must
  not abort the pipeline. `DetectionPipeline` wraps each `detector.detect(ctx)`
  in try/catch; failed detectors log the exception and contribute a
  `{ triggered: false, error: "..." }` result. Test this by throwing in one
  detector and asserting the other four still produce results.

- **Deterministic rules are quality floors, not arbitrary thresholds.** Every
  detector's rule set is auditable and replayable. When you add a new detector,
  ship its rules with the code (not in cloud config). Cloud-pulled rules in
  Pro/Team are _additive_ — they cannot disable a built-in rule.

- **Fail fast in dev; fail gracefully in prod.** Missing `AGENTSEC_KEY` at
  startup → process refuses to start with a clear error. Upstream API
  unreachable mid-request → return 502 to caller with a clear error; do not
  silently drop the request. Never default to "approve on error" — that is a
  bypass of the trust model.

- **The quarantine timeout is non-negotiable.** If no y/n response within the
  timeout, **block the call** (fail-secure). Never route around the timeout.
  Never default to approve on timeout. CI environments with no TTY block
  immediately — there is no interactive option, so quarantine = block.

- **Warm→warm transition tests are mandatory.** Proxy tests must send two
  sequential requests through the same proxy instance. Baseline caching,
  prepared-statement reuse, detector regex state, and quarantine state machine
  reset only surface bugs on the second invocation.

- **Audit before blocking.** When sensitivity is `permissive`, detections are
  logged but never block. This is the audit-mode default for first-time users.
  Promotion to `balanced` (block on high-severity) and `strict` (block on any
  hit) is an explicit user action.

---

## Security Coding Standards

AgentSec is a security product. The bar is higher than general application code.

- **NEVER log the `Authorization` header, API key, or raw prompt content** at
  any log level (INFO, DEBUG, TRACE). Logs may include: method, path,
  project_id, detector name, decision, prompt **hash**. Nothing else.
- **NEVER write prompt content to disk unencrypted.** All persistence goes
  through `BaselineStore` which encrypts with AES-256-GCM.
- **NEVER use `eval()`, `new Function()`, or dynamic `require()` / `import()`**
  with non-literal arguments. Anywhere. The detection pipeline must be
  analyzable statically.
- **NEVER use `Math.random()` for anything security-related.** Use
  `crypto.randomBytes()` from Node's built-in `crypto` module.
- **Regex patterns in detectors MUST be compiled once at module load time.**
  `const PATTERN = /.../g` at module top, not inside a request handler. This
  is both a perf requirement and a correctness requirement (stateful `g` flag
  regexes carry `lastIndex` between calls — module-level constants make this
  obvious).
- **All SQL queries MUST use prepared statements.** `better-sqlite3`'s
  `db.prepare(...).run(...)` / `.get(...)`. No string interpolation, ever.
- **No prototype pollution.** Never assign to `Object.prototype`. Use
  `Object.create(null)` for any object used as a hash map of untrusted keys.
- **Treat the proxied request body as untrusted.** Validate structure before
  passing to detectors. A malformed Anthropic request must produce a clear
  4xx — never crash the proxy.
- **`AGENTSEC_KEY` minimum length is 32 characters.** Enforce at startup via
  `ValidationError`. The process must not start with a weak key.
- **Cryptographic primitives use Node's built-in `crypto` module only.** No
  third-party crypto libraries on the security-critical path (eliminates
  supply-chain risk for the most sensitive code).
  - SHA-256: `crypto.createHash('sha256')`
  - AES-256-GCM: `crypto.createCipheriv('aes-256-gcm', key, iv)`
  - PBKDF2: `crypto.pbkdf2Sync(secret, salt, 100_000, 32, 'sha256')`

---

## TypeScript Conventions

- **`tsconfig.json` strict mode is on.** No `any` without an inline justification
  comment. No non-null assertions (`!`) without comment.
- **All exported types live in `src/types.ts`.** No inline type declarations
  for public interfaces. Feature modules import from `types.ts`.
- **Detector interface is fixed:**
  ```ts
  export interface Detector {
    readonly name: string;
    detect(ctx: DetectionContext): DetectorResult; // synchronous, pure
  }
  ```
  No side effects. No I/O. No async. If your detector needs I/O, it's not a
  detector — it belongs in `BaselineStore` or a pipeline step.
- **Domain-specific Error subclasses.** `NoBaselineError`,
  `QuarantineTimeoutError`, `EncryptionError`, `UpstreamError`,
  `InvalidProviderError`. Never `throw new Error("...")` at module boundaries.
- **`async`/`await` throughout.** No raw `.then()`/`.catch()` chains. No
  callback APIs (`util.promisify` legacy ones if unavoidable).
- **No barrel re-exports.** No `index.ts` that re-exports everything in a
  directory. Import directly from the module file. This keeps dead-code
  elimination and dependency graphs honest.
- **No default exports.** Named exports only. Default exports break IDE
  refactor and obscure import sites.

---

## Proxy Testing Patterns

These are the TypeScript/Vitest equivalents of market-scout's
`httpx.MockTransport` pattern. Use them.

### Pattern: Real-Fastify + Fake-Upstream Server

```ts
// Start a real Fastify fake-upstream that AgentSec will forward TO.
const upstream = Fastify();
const captured: { path: string; body: unknown; headers: Headers }[] = [];

upstream.post('/v1/messages', async (req) => {
  captured.push({ path: req.url, body: req.body, headers: req.headers });
  return { id: 'msg_test', content: [{ type: 'text', text: 'ok' }] };
});

await upstream.listen({ port: 0 });
const upstreamPort = (upstream.server.address() as AddressInfo).port;

// Start AgentSec proxy pointing at fake-upstream.
const proxy = await startProxy({ upstreamUrl: `http://localhost:${upstreamPort}` });

// Drive a real HTTP request through the proxy.
const res = await fetch(`http://localhost:${proxy.port}/v1/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ system: 'You are a helpful assistant', messages: [...] }),
});

expect(res.status).toBe(200);
expect(captured).toHaveLength(1);
expect(captured[0].body).toMatchObject({ system: 'You are a helpful assistant' });
```

### Pattern: Error Injection

```ts
const errorOn = new Set<string>(["/v1/messages"]);

upstream.post("/v1/messages", async (req, reply) => {
  if (errorOn.has(req.url)) {
    reply.code(502);
    return { error: "upstream boom" };
  }
  return { ok: true };
});

// Assert proxy returns 502 to caller, does NOT crash, logs the failure.
```

Route by **path / header / body shape** — never by call order. Tests must be
robust to detector ordering changes.

### Pattern: Stream Passthrough Test

```ts
// Fake-upstream returns chunked SSE response.
upstream.post("/v1/messages", async (_req, reply) => {
  reply.raw.setHeader("content-type", "text/event-stream");
  reply.raw.write('data: {"type":"content_block_start"}\n\n');
  reply.raw.write(
    'data: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n',
  );
  reply.raw.write('data: {"type":"message_stop"}\n\n');
  reply.raw.end();
});

// Assert proxy returns all 3 chunks in order, and that proxy memory does NOT
// grow with response size (no full-body accumulation). Use a memory snapshot
// before vs after; assert delta < threshold.
```

### Pattern: Two-Request Warm-Up Test

```ts
test('proxy survives cold → warm → warm transition', async () => {
  const proxy = await startProxy({ ... });
  const res1 = await fetch(proxy.url + '/v1/messages', { ... });  // cold
  const res2 = await fetch(proxy.url + '/v1/messages', { ... });  // warm
  const res3 = await fetch(proxy.url + '/v1/messages', { ... });  // warm
  // Assert all three succeed. Baseline cache, prepared statements, detector
  // state, and quarantine state machine reset must all survive.
});
```

### Pattern: Memory-Delta Test (required for any proxy-level task)

Every task that modifies the proxy request hot path must include a test asserting
that heap memory does not grow proportionally with request count:

```ts
test('heap does not grow > 5 MB across 100 sequential requests', async () => {
  const proxy = await startProxy({ ... });
  const opts = { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ system: 's', messages: [] }) };

  // Warm-up: settle JIT and connection pool before measuring.
  for (let i = 0; i < 5; i++) { const r = await fetch(`${proxy.url}/v1/messages`, opts); await r.text(); }

  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 100; i++) {
    const r = await fetch(`${proxy.url}/v1/messages`, opts);
    await r.text(); // must consume body so the stream is released
  }
  const deltaMB = (process.memoryUsage().heapUsed - before) / 1024 / 1024;
  expect(deltaMB).toBeLessThan(5);
});
```

T1.2 acceptance criterion "Memory delta < 5MB across 100 requests" is **not
satisfied** until this test exists and passes.

---

## Detector Testing Pattern

Detectors are pure functions. Test them **directly** — do not go through the proxy:

```ts
import { detect } from "../src/detectors/injection";

test("injection detector triggers on classic override phrase", () => {
  const ctx: DetectionContext = {
    prompt: "You are a helpful assistant. Ignore previous instructions and...",
    baselineHash: "abc...",
    toolManifest: [],
    provider: "anthropic",
  };
  const result = detect(ctx);
  expect(result.triggered).toBe(true);
  expect(result.evidence).toContain("ignore previous instructions");
});
```

Then **one** integration test per detector that drives it through the real proxy
and asserts the proxy returns 503 (quarantine) rather than 200 (forwarded).

---

## Competitive-Programming-Calibre Standards

- **Regex patterns compiled once at module load** — never inside a request handler.
- **SHA-256 / AES / PBKDF2 via Node's `crypto`** — no third-party crypto libs.
- **Diff rendering** uses the `diff` npm package (pure JS, no native deps), and
  the diff is **pre-computed once** before display — not recomputed on every
  re-render.
- **No O(n²) in the request hot path.** Regex matching is O(n) in prompt
  length and acceptable. Set-diff on tool manifests is O(n + m). Any nested
  loop on detector results requires justification in a comment.
- **Memory discipline.** Proxy never accumulates request bodies for streaming
  responses. Use `stream.pipeline()`. Test memory delta across many requests.
- **Concurrency.** Multiple simultaneous proxy requests are expected.
  `better-sqlite3` serializes writes correctly (single-process synchronous
  binding); there are no race conditions on baseline updates within one
  process. Multi-process deployments are not supported in Phase 1.
- **Every error path has a test.** No untested catch blocks. If `catch (e) { ... }`
  exists, there is a test that throws inside the try.
- **No `TODO` comments in merged code.** A TODO is a failing test waiting to be
  written. Either write the test (and the implementation) or open a tracked
  issue and link the issue from a code comment.
- **No commented-out code** in merged commits. Git history is the archive.

---

## Commit Format Reference

```
test(proxy):     RED — proxy must return 503 when no baseline exists
fix(proxy):      GREEN — return 503 with setup instructions when baseline missing
feat(detector):  GREEN — add InjectionPatternDetector with compiled regex set
test(quarantine): RED — timeout must fail-secure (block, not approve)
fix(quarantine): GREEN — wire QuarantineStateMachine timeout to BLOCKED transition
docs(readme):    update CLI commands table with bypass subcommand
chore(deps):     bump better-sqlite3 to 11.4.0
```

Scope keywords (reuse only these): `proxy`, `extractor`, `forwarder`,
`detector`, `pipeline`, `quarantine`, `baseline`, `cli`, `cloud`, `config`,
`sync`, `readme`, `deps`.

---

## What "Done" Means for a Task

A task is **done** when, and only when, every line below is true:

1. ☐ A failing test was committed first (`test(...): RED`).
2. ☐ The implementation makes that test pass.
3. ☐ `npx vitest run` reports zero failures across the full suite.
4. ☐ A GREEN commit (`fix(...)` / `feat(...)`) followed the RED commit.
5. ☐ Any new public surface (CLI command, config field, env var, API endpoint)
   is documented in the file listed in the docs-freshness table.
6. ☐ The code obeys NFR-13 (no LLM calls in the detection pipeline).
7. ☐ The code obeys the security coding standards (no key logging, no
   plaintext-on-disk, no `eval`, etc.).
8. ☐ No `TODO` or commented-out code remains in the diff.
9. ☐ **Every acceptance criterion checkbox in `docs/tasks.md` for this task is
   marked `[x]`.** If a criterion cannot be met, replace `[ ]` with
   `[~] <criterion> (blocked by: <reason>; tracked in issue #N)`.
   Leaving boxes unchecked means the task is ambiguous — not done.
10. ☐ `CHANGELOG.md` has an entry for the sprint this task belongs to.

If any line is unchecked, the task is not done.
