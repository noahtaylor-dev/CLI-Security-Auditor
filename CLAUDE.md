# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Node CLI that audits a git diff for security/bug/structure issues by sending it to Claude. Single-shot API call per run; no agentic loop, no caching, no CI integration. See [README.md](README.md) for end-user usage.

## Commands

```sh
npm install                         # install deps
npm link                            # makes `cli-auditor` available globally (optional)
node bin/cli-auditor.js [opts]      # run without linking
npm start -- [opts]                 # equivalent
```

There is no test suite, no linter, and no build step (plain ESM, runs directly on Node ≥18).

API key required for any real run: set `ANTHROPIC_API_KEY` in env or in `.env` (loaded via dotenv in `src/cli.js`).

## Architecture

Six modules under `src/`, plus a thin shebang entry in `bin/`. Data flows one direction:

```
bin/cli-auditor.js → src/cli.js → src/banner.js (logo + analyzing message)
                                → src/git.js  (get diff)
                                → src/anthropic.js → src/prompt.js  (call Claude)
                                → src/render.js  (format output)
```

Load-bearing decisions worth knowing before editing:

- **Structured output is enforced via tool_use, not JSON-in-text.** [src/anthropic.js](src/anthropic.js) sets `tool_choice: { type: 'tool', name: 'report_findings' }` against the schema in [src/prompt.js](src/prompt.js). The response is read from `content[].input` of the tool_use block — there is no `JSON.parse` of model text anywhere, and there should not be. If you change the report shape, update **both** `TOOL_SCHEMA` (input_schema) and the `SYSTEM_PROMPT` rubric (severity/risk-score guidance) in `prompt.js`, plus all three renderers in `render.js`.

- **Always exits 0.** This is intentional — the tool is advisory, not a CI gate. Even errors (`Not a git repository`, missing API key, API failure) print to stderr and `process.exit(0)`. Do not change this without an explicit ask; downstream tooling may rely on it.

- **Git is invoked via `execFileSync` with an args array, never a shell string.** This is the reason `--commit <sha>` and `--branch <name>` can accept user-controlled refs safely. Preserve this — never switch to `exec` / template-string composition for git commands.

- **Repo presence is checked separately** with `git rev-parse --is-inside-work-tree` before the diff command. Without this, `git diff --staged` outside a repo falls back to `--no-index` mode and dumps unrelated help text instead of a clean error. Keep `assertInRepo()` as the first call in `getDiff`.

- **Diff scope flags are mutually exclusive** (`--staged | --unstaged | --commit | --branch`); CLI enforces this manually rather than via commander's `.conflicts()`. Default is `staged`.

- **Default model is `claude-sonnet-4-6`** (constant `DEFAULT_MODEL` in [src/cli.js](src/cli.js)). Override per-run with `--model`.

- **`.env` is loaded from cwd first, then from the install dir** (`INSTALL_DIR` in [src/cli.js](src/cli.js)). dotenv does not overwrite already-set vars, so per-project `.env` files win over the install-dir fallback. This is what lets the user `cd` into any repo and still pick up the API key from `D:\CLI_Auditor\.env`.

- **Report output is intentionally flush-left** ([src/render.js](src/render.js)). Findings have no leading-space indentation; visual rhythm comes from the `── i/N ──` separator between entries. Do not re-indent the body — the user explicitly asked for left-alignment.

- **The banner and "Analyzing..." line are suppressed when `--json` is set.** Both go to stdout, so emitting them in JSON mode would corrupt downstream piping. If you add another pre-API status message, gate it the same way.

## When extending

- New diff scope → add a case in `diffArgsFor()` in [src/git.js](src/git.js) and a flag in [src/cli.js](src/cli.js).
- New finding category or severity → update the enum in `TOOL_SCHEMA`, the rubric in `SYSTEM_PROMPT`, and `SEVERITY_COLOR`/`SEVERITY_ORDER` in [src/render.js](src/render.js).
- New output format → add a renderer in [src/render.js](src/render.js) and wire a flag in [src/cli.js](src/cli.js); follow the existing `--json` / `--md` pattern.
