/**
 * src/banner.js — startup visuals.
 *
 * Two exports, both called from src/cli.js and both suppressed when --json
 * is set (the banner would corrupt machine-readable stdout):
 *
 *   printBanner()    — one-time ASCII logo + tagline shown when the CLI
 *                      starts. Pure cosmetic.
 *   printAnalyzing() — single-line status printed right before the API
 *                      call so the user knows the silent ~10s wait is the
 *                      network, not a hang.
 *
 * Both write directly to stdout; neither returns anything.
 */
import chalk from 'chalk';

// "CLI AUDITOR" rendered in the ANSI Shadow figlet font. Each entry is one
// horizontal row of the logo. Indentation matters — the leading spaces on
// rows 1 and 6 form the curved corners of the C and the underscores of the
// shadow. Don't reflow.
const LOGO_LINES = [
  ' ██████╗██╗     ██╗     █████╗ ██╗   ██╗██████╗ ██╗████████╗ ██████╗ ██████╗ ',
  '██╔════╝██║     ██║    ██╔══██╗██║   ██║██╔══██╗██║╚══██╔══╝██╔═══██╗██╔══██╗',
  '██║     ██║     ██║    ███████║██║   ██║██║  ██║██║   ██║   ██║   ██║██████╔╝',
  '██║     ██║     ██║    ██╔══██║██║   ██║██║  ██║██║   ██║   ██║   ██║██╔══██╗',
  '╚██████╗███████╗██║    ██║  ██║╚██████╔╝██████╔╝██║   ██║   ╚██████╔╝██║  ██║',
  ' ╚═════╝╚══════╝╚═╝    ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝',
];

// Per-row chalk styler — gives the logo a vertical cyan→blue→magenta
// gradient. Index aligns with LOGO_LINES, so changing the logo height
// requires updating this array too.
const LOGO_COLORS = [
  chalk.cyanBright,
  chalk.cyan,
  chalk.blueBright,
  chalk.blue,
  chalk.magentaBright,
  chalk.magenta,
];

/**
 * Print the ASCII logo, tagline, and surrounding blank lines to stdout.
 * Call once per invocation, before any other output.
 */
export function printBanner() {
  console.log('');
  // Iterate rather than .forEach so the index/colour pairing is obvious.
  for (let i = 0; i < LOGO_LINES.length; i++) {
    console.log(LOGO_COLORS[i].bold(LOGO_LINES[i]));
  }
  console.log('');
  console.log(chalk.dim('  Security & code-quality audit for your git diffs, powered by Claude.'));
  console.log('');
}

/**
 * Print the "Analyzing N files..." status line shown just before the API
 * call kicks off. The pluralisation and the scope label are computed here
 * so the call site stays clean.
 *
 * @param {Object} args
 * @param {number} args.fileCount  Number of changed files in the diff.
 * @param {string} args.scope      'staged' | 'unstaged' | 'commit' | 'branch'.
 * @param {string} args.model      Model id, e.g. 'claude-sonnet-4-6'.
 */
export function printAnalyzing({ fileCount, scope, model }) {
  // 'staged' reads naturally as "staged changes"; the others ('unstaged',
  // 'commit', 'branch') already work as a noun adjunct, so the same shape
  // ("$scope changes") sounds right.
  const scopeLabel = scope === 'staged' ? 'staged changes' : `${scope} changes`;
  console.log(
    chalk.yellow('▸ ') +
      chalk.bold(`Analyzing ${fileCount} file${fileCount === 1 ? '' : 's'} `) +
      chalk.dim(`(${scopeLabel}, model: ${model})...`)
  );
  console.log('');
}
