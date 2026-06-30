# OpenAI Codex setup

Codex loads project instructions automatically from `AGENTS.md` at the repository root. This repo also provides `CODEX.md` (same content via `@AGENTS.md` include).

## Quick start

1. Install [Codex CLI](https://developers.openai.com/codex) and sign in.
2. Clone the repo and copy `.env.example` → `.env.local`.
3. Run `npm install` and `npm run dev`.
4. Open the project in Codex — it reads `AGENTS.md` before any task.

## Optional: global preferences

Create `~/.codex/AGENTS.md` for personal rules that apply to all projects (communication style, review preferences).

## Optional: recognize CLAUDE.md

If your team uses both Claude Code and Codex, add to `~/.codex/config.toml`:

```toml
# Increase limit if AGENTS.md grows (default 32 KiB)
project_doc_max_bytes = 65536

# Treat Claude Code's entry file as project instructions when AGENTS.md is absent in a subfolder
project_doc_fallback_filenames = ["CLAUDE.md", "CODEX.md"]
```

## Verify loaded instructions

Codex CLI (April 2026+):

```bash
codex --print-instructions
```

Or ask Codex to summarize which instruction files it loaded for the current session.

## Claude Code parity

| Concern | Claude Code | Codex |
|---------|-------------|-------|
| Project instructions | `CLAUDE.md` → `AGENTS.md` | `AGENTS.md` / `CODEX.md` |
| Global preferences | Claude settings | `~/.codex/AGENTS.md` |
| Auth | `claude auth login` | Codex account login |

Application runtime LLM providers (Gemini, Claude API, Ollama) are configured in `.env.local`, not by which coding agent you use.
