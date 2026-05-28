# Changelog

All notable changes to AgentSec are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Sprint 1] — 2026-05-28 (v0.1.0)

### Added

- **Project scaffolding (T1.1)** — TypeScript 5.5 strict mode, Vitest v2, Commander.js v12, Fastify v5, undici v7. CI workflow runs `vitest`, `check:nollm`, `check:trace`, and license check on every push. ESLint v9 with typescript-eslint v8 flat-config.
- **`src/config.ts` — AGENTSEC_KEY validation (NFR-7)** — `loadConfig()` enforces key ≥ 32 characters at startup via `ValidationError`. Proxy refuses to start with a weak or missing key.
- **Fastify proxy happy-path (T1.2)** — `src/proxy/server.ts` + `src/proxy/forwarder.ts`. Routes `POST /v1/messages` and `POST /v1/chat/completions`. Uses `stream.pipeline()` + `reply.hijack()` for zero-copy SSE passthrough. Hop-by-hop headers stripped in both directions.
- **SystemPromptExtractor for Anthropic (T1.3)** — `src/proxy/extractor.ts`. Pure function. Handles string and content-block-array `system` fields. Normalises `tools` array. Throws `InvalidProviderError` on malformed input.
- **Domain error classes** — `src/errors.ts`: `NoBaselineError`, `QuarantineTimeoutError`, `EncryptionError`, `UpstreamError`, `InvalidProviderError`, `ValidationError`.
- **Shared types** — `src/types.ts`: `NormalizedPrompt`, `Baseline`, `DetectionContext`, `DetectorResult`, `ThreatReport`, `Detector` interface, `QuarantineState`.
- **`scripts/check-no-llm-calls.ts`** — CI gate enforcing NFR-13 (no LLM API calls in detection pipeline, quarantine, or baseline modules).
- **19 tests passing** — 1 smoke, 7 config, 6 extractor unit tests, 5 proxy integration tests (including memory-delta assertion).

### Fixed (retrospective closures)

- Added missing production deps `better-sqlite3@^11`, `pino@^9`, `diff@^7`, `js-yaml@^4` and dev deps `@types/*`, `eslint@^9`, `typescript-eslint@^8`, `license-checker-rseidelsohn` — all now pinned in `package.json`.
- Added `lint` script (`eslint src/ tests/ scripts/ --max-warnings 0`) and `eslint.config.mjs`.
- Added memory-delta test to proxy integration suite (closes T1.2 open acceptance criterion).
- Marked all Sprint 1 acceptance criteria `[x]` in `docs/tasks.md`.

### Open (tracked)

- T1.2: P50 latency benchmark < 50ms not yet tested — tracked for T1.2 follow-up.
- OpenAI provider extraction (T1.20) deferred to Sprint 5.

---
