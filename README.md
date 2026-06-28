# SOP Software

Pharma SOP management platform with MCQ generation for LMS training, regulatory compliance auditing, and training-matrix workflows.

**Stack:** Next.js 16, TypeScript, MongoDB, Gemini / Claude / Ollama.

## Getting started

```bash
npm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
# Edit .env.local — at minimum set MONGODB_URI
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Seed an admin user with `npm run seed:admin`.

## AI coding agents (Claude Code or Codex)

This codebase is designed to be developed with either **Claude Code** or **OpenAI Codex** interchangeably. Both read shared instructions from [`AGENTS.md`](./AGENTS.md).

| Tool | Entry file | Docs |
|------|------------|------|
| Claude Code | [`CLAUDE.md`](./CLAUDE.md) | `claude auth login` |
| OpenAI Codex | [`CODEX.md`](./CODEX.md) | [docs/codex-setup.md](./docs/codex-setup.md) |

Edit `AGENTS.md` for project-wide agent rules (architecture, commands, conventions). Tool-specific setup lives in the docs above.

## Runtime LLM providers

The **application** uses LLM APIs at runtime for MCQ generation and compliance — independent of which coding agent you use.

| Task | Default provider | Config |
|------|------------------|--------|
| MCQ generation | Claude (CLI or Anthropic API) | `LLM_PROVIDER=claude` |
| Compliance analysis | Gemini | `LLM_COMPLIANCE_PROVIDER=gemini` |

Set `ANTHROPIC_API_KEY` for faster MCQ generation via the Anthropic API (no local `claude` CLI required). Set `GEMINI_API_KEY` for compliance. See [`.env.example`](./.env.example) for all variables.

## Key features

- **SOP registry** — Upload DOCX/PDF, version tracking, Bunny CDN storage
- **MCQ bank** — Async batch generation (up to 100 MCQs per SOP/language), progress polling, retry/cancel
- **Compliance** — Audit SOPs against ICH, EU-GMP, WHO, PIC/S guidelines
- **LMS** — Training journeys, quizzes, certificates
- **Training matrices** — Department assignments and induction tracking

## Project layout

```
app/          Next.js pages and API routes
lib/          Business logic (MCQ, compliance, LLM, caches)
models/       Mongoose schemas
components/   React UI
scripts/      Dev server, diagnostics, seeds
memory/       Agent-oriented project notes
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server (frees port 3000 first) |
| `npm run dev:clean` | Clean `.next` and start |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run seed:admin` | Create admin user |

**MCQ diagnostics:** `npx tsx scripts/diag-mcqgen.ts` · **Force-stop jobs:** `npx tsx scripts/stop-mcq-gen.ts`

## Learn more

- Agent instructions: [`AGENTS.md`](./AGENTS.md)
- Codex setup: [`docs/codex-setup.md`](./docs/codex-setup.md)
- Cache invalidation rules: [`memory/sop-cache-instant-sync.md`](./memory/sop-cache-instant-sync.md)
