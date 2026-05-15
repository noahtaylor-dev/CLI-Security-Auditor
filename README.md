# cli-auditor

Audit staged git changes for security vulnerabilities, bugs, and structural issues — powered by Claude.

Run it before you commit. It diffs your staged changes, sends them to Claude with a security-engineer system prompt, and prints a human-readable report with a 1–10 risk score and concrete fix suggestions.

## Install

```sh
npm install
npm link    # makes `cli-auditor` available globally
```

Set your API key:

```sh
cp .env.example .env
# edit .env and paste your ANTHROPIC_API_KEY
```

(Or export `ANTHROPIC_API_KEY` in your shell.)

## Usage

```sh
# Default: audit staged changes
cli-auditor

# Other diff scopes
cli-auditor --unstaged
cli-auditor --commit <sha>
cli-auditor --branch main

# Output formats
cli-auditor --json                # raw JSON to stdout
cli-auditor --md report.md        # also write a Markdown report

# Override the model
cli-auditor --model claude-opus-4-7
```

## What it looks for

- **Security**: hardcoded secrets, SQL/command/prompt injection, XSS, broken auth, weak crypto, SSRF, path traversal, IDOR, insecure CORS, plaintext credential transport, and other OWASP Top 10 issues.
- **Bugs**: missing `await`, null/undefined dereferences, off-by-one errors, wrong error handling, unreachable branches.
- **Structure**: inconsistent naming/formatting, duplicated logic, dead code.

Each finding includes a category, severity, file/line (when identifiable), description, and concrete fix.

## Notes

- Always exits with code `0` — this is an advisory tool, not a CI gate.
- Only added/modified lines are reviewed (the `+` side of the diff).
- Empty diff → "No changes to audit", no API call.
