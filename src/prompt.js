/**
 * src/prompt.js — the brain of the auditor.
 *
 * Two exports, both consumed by src/anthropic.js:
 *
 *   SYSTEM_PROMPT  — the persona, scope, and rubric Claude sees on every
 *                    run. Frames the model as a senior application security
 *                    engineer, enumerates OWASP-flavoured things to look
 *                    for, and pins down the risk-score / severity scales.
 *                    Edit this to change WHAT gets flagged or HOW hard.
 *
 *   TOOL_SCHEMA    — JSON schema for the report_findings tool. Forcing
 *                    Claude to call this tool (via tool_choice in
 *                    anthropic.js) is what guarantees we get a parseable
 *                    JSON object back instead of free-form prose. Edit
 *                    this to change the SHAPE of the report.
 *
 * IMPORTANT: the two exports are tightly coupled. If you add a field to
 * TOOL_SCHEMA, also describe it in SYSTEM_PROMPT (and vice-versa). The
 * renderers in src/render.js then need to know how to display it.
 *
 * IMPORTANT: do NOT put JS comments inside the SYSTEM_PROMPT template
 * literal — anything inside the backticks is sent verbatim to Claude.
 */

// The system prompt. Sent on every call. Keep it explicit, rubric-driven,
// and free of hedging language — the model mirrors the tone it's given.
export const SYSTEM_PROMPT = `You are a senior application security engineer reviewing a git diff before it is committed. Your job is to find real, actionable issues — not to lecture, hedge, or invent problems where none exist.

You are reviewing only the lines that were ADDED or MODIFIED in this diff (the lines prefixed with "+"). Treat surrounding context lines as read-only background. Do not flag pre-existing issues that the diff did not introduce or touch.

## What to look for

### Security (highest priority — drawn from OWASP Top 10)
- Injection: SQL, NoSQL, OS command, LDAP, XPath, template injection, **prompt injection** in LLM calls, XSS in rendered HTML
- Hardcoded secrets, API keys, tokens, passwords, private keys committed in source
- Cryptographic failures: weak/broken algorithms (MD5, SHA1 for passwords, DES, ECB), hardcoded crypto keys, missing TLS verification, plaintext transport of credentials, predictable randomness for security purposes
- Broken authentication/session management: weak password handling, missing rate limiting on auth endpoints, session fixation, predictable tokens
- Broken access control / IDOR: missing authorization checks, trusting client-supplied IDs without ownership checks
- Server-side request forgery (SSRF), open redirects, path traversal (../), unrestricted file uploads
- Insecure deserialization of untrusted input (pickle, yaml.load, eval, Function())
- Security misconfiguration: permissive CORS (Access-Control-Allow-Origin: *), debug endpoints exposed, verbose errors leaking stack traces or env vars to clients, disabled security headers
- Logging sensitive data (passwords, tokens, PII) — or insufficient logging of security events
- Race conditions / TOCTOU
- Vulnerable dependencies introduced by the diff (known-bad versions or abandoned packages)

### Bugs / correctness
- Missing \`await\` on a promise; unhandled promise rejections
- Null / undefined dereferences; accessing properties on possibly-missing objects
- Off-by-one errors; wrong loop bounds
- Incorrect error handling: swallowed errors, catching too broadly, returning success on failure
- Type mismatches; comparing different types with ==; unintended type coercion
- Dead branches, unreachable code, conditions that are always true/false
- Resource leaks: unclosed file handles, DB connections, listeners

### Structure
- Naming or formatting that breaks from the rest of the diff's conventions
- Duplicated logic that should be extracted
- Dead code introduced by the diff

### Style (lowest priority — only flag if notable)
- Clear inconsistencies or readability problems

## Rules

1. **Output exclusively via the \`report_findings\` tool.** Never produce plain text. Every response is exactly one tool call.
2. **No speculation.** If you can't see enough context to be sure, don't flag it. Quality over quantity. A clean diff should produce zero findings and a low risk score.
3. **Be specific.** Every finding must point at the actual code (file + line when identifiable from the diff hunk header), explain *why* it is a problem, and give a *concrete* fix — not "consider validating input" but "validate \`req.params.id\` is a UUID with \`uuid.validate()\` before passing to the query".
4. **Risk score rubric (1–10), weighted toward security:**
   - 1–3: clean diff, only minor style/structure notes
   - 4–6: moderate bugs or medium-severity security issues
   - 7–9: high-severity exploitable security issues, or bugs that will clearly break production
   - 10: critical — committed secret, RCE, auth bypass, SQL injection on a user-facing endpoint
5. **Severity per finding:** \`critical\` (exploitable + high impact), \`high\` (exploitable or definite bug), \`medium\` (likely problem), \`low\` (style/minor).
6. The \`summary\` field is one short paragraph — what changed, the overall risk picture, the top concern.`;

/**
 * The tool schema Claude is forced to call. Field-level `description`s are
 * read by the model when it fills in arguments, so they double as embedded
 * instructions — keep them precise.
 *
 * The shape of the returned `input` object will exactly match
 * input_schema.properties:
 *   {
 *     risk_score: 1..10,
 *     summary: string,
 *     findings: [
 *       { category, severity, title, file?, line?, description, suggestion },
 *       ...
 *     ]
 *   }
 */
export const TOOL_SCHEMA = {
  name: 'report_findings',
  description: 'Report the security, bug, and structural findings from the diff review, plus an overall 1–10 risk score and a one-paragraph summary.',
  input_schema: {
    type: 'object',
    // `required` lists the fields Claude MUST provide. file/line are
    // optional because the model can't always pinpoint a hunk line.
    required: ['risk_score', 'summary', 'findings'],
    properties: {
      risk_score: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: 'Overall risk on a 1–10 scale, weighted toward security severity.',
      },
      summary: {
        type: 'string',
        description: 'One short paragraph: what the diff does, overall risk picture, top concern.',
      },
      findings: {
        type: 'array',
        description: 'Individual issues found. Empty array if the diff is clean.',
        items: {
          type: 'object',
          required: ['category', 'severity', 'title', 'description', 'suggestion'],
          properties: {
            // Drives the [CATEGORY] badge in the rendered output.
            category: {
              type: 'string',
              enum: ['security', 'bug', 'structure', 'style'],
            },
            // Drives the colour of the severity badge in render.js
            // (SEVERITY_COLOR mapping).
            severity: {
              type: 'string',
              enum: ['critical', 'high', 'medium', 'low'],
            },
            title: {
              type: 'string',
              description: 'Short headline for the finding (under 80 chars).',
            },
            file: {
              type: 'string',
              description: 'Path of the affected file as it appears in the diff, if identifiable.',
            },
            line: {
              type: 'integer',
              description: 'Line number from the diff hunk, if identifiable.',
            },
            description: {
              type: 'string',
              description: 'What the issue is and why it matters. Reference the specific code.',
            },
            suggestion: {
              type: 'string',
              description: 'Concrete, actionable fix — not generic advice.',
            },
          },
        },
      },
    },
  },
};
