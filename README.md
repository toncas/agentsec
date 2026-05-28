# AgentSec

> Transparent agent security proxy. No code changes. No LLM in detection. Local-first.

AgentSec is a local HTTP proxy that sits between AI coding agents (Claude Code,
Cursor, Cline, OpenAI Codex, any `BASE_URL`-respecting SDK) and the upstream
LLM API, and runs a **deterministic, cryptographic** detection pipeline against
every system prompt. If a threat is detected, the request is **quarantined** —
paused while you review a unified diff in your terminal and approve or deny.

AgentSec's value proposition is precisely that **it is not an AI**. Detection
is rule-based and reproducible. See [`docs/PRD.md`](docs/PRD.md) for the full
product brief and [`docs/design.md`](docs/design.md) for architecture.

> **Status:** Phase 1 in active development. Not yet released to npm.

---

## Install

```bash
# Once published:
npm install -g agentsec
```

Requires Node.js 20.x LTS or 22.x LTS.

---

## Quick Start

```bash
# 1. Generate a 32-byte encryption key (keep it secret, treat like a password)
export AGENTSEC_KEY="$(openssl rand -hex 32)"

# 2. Start the proxy
agentsec start

# 3. Point your agent at it
export ANTHROPIC_BASE_URL=http://localhost:7777
export OPENAI_BASE_URL=http://localhost:7777/v1

# 4. Approve the current system prompt as your trusted baseline
agentsec approve
```

See [`docs/deployment.md`](docs/deployment.md) for full setup, including
Claude Code / Cursor / Cline configuration and CI usage.

---

## Environment Variables

| Variable                          | Default                      | Description                                                     |
| --------------------------------- | ---------------------------- | --------------------------------------------------------------- |
| `AGENTSEC_KEY`                    | _required_                   | Encryption key for baselines. Must be ≥ 32 chars.               |
| `AGENTSEC_PORT`                   | `7777`                       | Local proxy port.                                               |
| `AGENTSEC_UPSTREAM_URL`           | `https://api.anthropic.com`  | Upstream LLM API base URL.                                      |
| `AGENTSEC_SENSITIVITY`            | `balanced`                   | `strict` \| `balanced` \| `permissive`.                         |
| `AGENTSEC_QUARANTINE_TIMEOUT_SEC` | `60`                         | Seconds to wait for y/n response before fail-secure block.      |
| `AGENTSEC_PROJECT`                | `SHA-256(CWD)` (truncated)   | Override the per-project identifier.                            |
| `AGENTSEC_CLOUD_API_KEY`          | _(unset)_                    | Pro/Team — enables cloud sync (also requires explicit opt-in).  |
| `AGENTSEC_WEBHOOK_URL`            | _(unset)_                    | Pro — quarantine event webhook.                                 |
| `AGENTSEC_WEBHOOK_FORMAT`         | `generic`                    | `telegram` \| `slack` \| `generic`.                             |

See [`.env.example`](.env.example) for a copy-pasteable template.

---

## Development

```bash
npm install
npx vitest run             # full regression suite
npx tsx scripts/check-no-llm-calls.ts
```

This project follows strict TDD (RED → GREEN). See
[`.github/copilot-instructions.md`](.github/copilot-instructions.md) for the
full standing order and [`docs/tasks.md`](docs/tasks.md) for the task plan.

---

## License

Apache 2.0 — see [`LICENSE`](LICENSE).
