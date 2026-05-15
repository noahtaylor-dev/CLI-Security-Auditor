/**
 * src/render.js — output formatting for the audit report.
 *
 * Three exported renderers, each takes the parsed report object from
 * src/anthropic.js and returns a string:
 *
 *   renderTerminal  — colored, flush-left output for an interactive shell.
 *                     Used when the user runs `cli-auditor` normally.
 *   renderJson      — pretty-printed JSON for piping into jq, GitHub
 *                     Actions, etc. Triggered by --json.
 *   renderMarkdown  — Markdown body suitable for pasting into a PR
 *                     description. Triggered by --md <path>.
 *
 * Layout invariant for renderTerminal: every finding line starts at column
 * zero. The user explicitly asked for left-alignment; visual rhythm comes
 * from the `── i/N ──────` separator between entries, not from indentation.
 * Do not re-indent.
 */
import chalk from 'chalk';

// Severity → chalk styling for the inline [SECURITY · HIGH] badges.
// Critical uses a background colour so it can't be missed when scrolling.
const SEVERITY_COLOR = {
  critical: chalk.bgRed.white.bold,
  high: chalk.redBright.bold,
  medium: chalk.yellow.bold,
  low: chalk.gray.bold,
};

// Sort weights — lower number prints first. Anything with an unrecognized
// severity (shouldn't happen — schema-enforced) sorts to the bottom via the
// `?? 9` fallback below.
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Map the 1–10 risk score to a band label + chalk style for the header.
 * Bands are coarser than the 10-point score so the eye reads them quickly.
 *
 * @param {number} score  Integer 1–10 from Claude.
 * @returns {{label: string, color: Function}}
 */
function riskBand(score) {
  if (score >= 9) return { label: 'CRITICAL', color: chalk.bgRed.white.bold };
  if (score >= 7) return { label: 'HIGH', color: chalk.redBright.bold };
  if (score >= 4) return { label: 'MEDIUM', color: chalk.yellow.bold };
  return { label: 'LOW', color: chalk.green.bold };
}

/**
 * Return a copy of `findings` ordered by severity (critical → low). We copy
 * with the spread to avoid mutating Claude's response.
 */
function sortFindings(findings) {
  return [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  );
}

/**
 * Render the report as colored, flush-left terminal output.
 *
 * @param {Object} report  Parsed report from src/anthropic.js.
 * @returns {string}       Multi-line, ANSI-coloured text ready for console.log.
 */
export function renderTerminal(report) {
  const { risk_score, summary, findings = [] } = report;
  const band = riskBand(risk_score);
  // Build line by line into an array, then join at the end. Easier to
  // reason about than chained string concatenation.
  const lines = [];

  // Header block: title divider, score with band badge, then the
  // model-written summary paragraph.
  lines.push('');
  lines.push(chalk.bold('━━━ CLI Auditor Report ━━━'));
  lines.push('');
  lines.push(`${chalk.bold('Risk score:')} ${band.color(`${risk_score}/10`)}  ${band.color(`[${band.label}]`)}`);
  lines.push('');
  lines.push(summary);
  lines.push('');

  // Clean diff → short happy-path message and exit.
  if (findings.length === 0) {
    lines.push(chalk.green('No findings. Diff looks clean.'));
    lines.push('');
    return lines.join('\n');
  }

  lines.push(chalk.bold(`Findings (${findings.length}):`));
  lines.push('');

  // One block per finding. The `── i/N ──` separator gives the eye a
  // consistent place to land even with no indentation.
  for (const [i, f] of sortFindings(findings).entries()) {
    const sevColor = SEVERITY_COLOR[f.severity] ?? chalk.white;
    const badge = `[${chalk.cyan(f.category.toUpperCase())} · ${sevColor(f.severity.toUpperCase())}]`;
    // file:line — dimmed because it's metadata, not the message itself.
    const loc = f.file ? chalk.dim(f.file + (f.line ? `:${f.line}` : '')) : '';

    // Build a separator like "── 2/5 ──────────────…". The repeat() count
    // is a rough constant-width target so longer indices don't push it past
    // 50 characters and wrap on narrow terminals.
    lines.push(chalk.dim(`── ${i + 1}/${findings.length} ${'─'.repeat(Math.max(0, 50 - String(i + 1).length - String(findings.length).length))}`));
    lines.push(`${badge} ${chalk.bold(f.title)}`);
    if (loc) lines.push(loc);
    lines.push(f.description);
    lines.push(`${chalk.green('Fix:')} ${f.suggestion}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Pretty-print the raw report as JSON. Used with --json so callers can
 * pipe the output into jq, gh comment, etc. No colours, no extra prose.
 */
export function renderJson(report) {
  return JSON.stringify(report, null, 2);
}

/**
 * Render the report as GitHub-flavoured Markdown. Same content as the
 * terminal renderer but formatted for paste into a PR description or
 * commit body. Used by --md <path>.
 *
 * @param {Object} report
 * @returns {string}  Markdown body (no leading frontmatter).
 */
export function renderMarkdown(report) {
  const { risk_score, summary, findings = [] } = report;
  const band = riskBand(risk_score);
  const lines = [];

  // Top-level heading + risk score on its own line so it shows up clearly
  // in the GitHub PR sidebar preview.
  lines.push('# CLI Auditor Report');
  lines.push('');
  lines.push(`**Risk score:** ${risk_score}/10 \`${band.label}\``);
  lines.push('');
  lines.push(summary);
  lines.push('');

  if (findings.length === 0) {
    lines.push('_No findings. Diff looks clean._');
    return lines.join('\n');
  }

  lines.push(`## Findings (${findings.length})`);
  lines.push('');

  // Each finding becomes an h3 with a code-fenced location, the prose
  // description, and a bold "Fix:" line.
  for (const f of sortFindings(findings)) {
    const loc = f.file ? ` — \`${f.file}${f.line ? `:${f.line}` : ''}\`` : '';
    lines.push(`### [${f.category.toUpperCase()} · ${f.severity.toUpperCase()}] ${f.title}${loc}`);
    lines.push('');
    lines.push(f.description);
    lines.push('');
    lines.push(`**Fix:** ${f.suggestion}`);
    lines.push('');
  }

  return lines.join('\n');
}
