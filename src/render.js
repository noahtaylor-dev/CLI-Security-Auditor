import chalk from 'chalk';

const SEVERITY_COLOR = {
  critical: chalk.bgRed.white.bold,
  high: chalk.redBright.bold,
  medium: chalk.yellow.bold,
  low: chalk.gray.bold,
};

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function riskBand(score) {
  if (score >= 9) return { label: 'CRITICAL', color: chalk.bgRed.white.bold };
  if (score >= 7) return { label: 'HIGH', color: chalk.redBright.bold };
  if (score >= 4) return { label: 'MEDIUM', color: chalk.yellow.bold };
  return { label: 'LOW', color: chalk.green.bold };
}

function sortFindings(findings) {
  return [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  );
}

export function renderTerminal(report) {
  const { risk_score, summary, findings = [] } = report;
  const band = riskBand(risk_score);
  const lines = [];

  lines.push('');
  lines.push(chalk.bold('━━━ CLI Auditor Report ━━━'));
  lines.push('');
  lines.push(`${chalk.bold('Risk score:')} ${band.color(`${risk_score}/10`)}  ${band.color(`[${band.label}]`)}`);
  lines.push('');
  lines.push(summary);
  lines.push('');

  if (findings.length === 0) {
    lines.push(chalk.green('No findings. Diff looks clean.'));
    lines.push('');
    return lines.join('\n');
  }

  lines.push(chalk.bold(`Findings (${findings.length}):`));
  lines.push('');

  for (const [i, f] of sortFindings(findings).entries()) {
    const sevColor = SEVERITY_COLOR[f.severity] ?? chalk.white;
    const badge = `[${chalk.cyan(f.category.toUpperCase())} · ${sevColor(f.severity.toUpperCase())}]`;
    const loc = f.file ? chalk.dim(f.file + (f.line ? `:${f.line}` : '')) : '';

    lines.push(chalk.dim(`── ${i + 1}/${findings.length} ${'─'.repeat(Math.max(0, 50 - String(i + 1).length - String(findings.length).length))}`));
    lines.push(`${badge} ${chalk.bold(f.title)}`);
    if (loc) lines.push(loc);
    lines.push(f.description);
    lines.push(`${chalk.green('Fix:')} ${f.suggestion}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function renderJson(report) {
  return JSON.stringify(report, null, 2);
}

export function renderMarkdown(report) {
  const { risk_score, summary, findings = [] } = report;
  const band = riskBand(risk_score);
  const lines = [];

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
