/**
 * src/cli.js — top-level orchestration.
 *
 * This module owns the lifecycle of a single `cli-auditor` invocation:
 *
 *   1. Load configuration from .env files (cwd, then install dir).
 *   2. Parse command-line arguments via commander.
 *   3. Print the banner (unless we're emitting JSON for piping).
 *   4. Resolve the diff scope (staged / unstaged / commit / branch) and
 *      ask src/git.js for the actual diff text + changed file list.
 *   5. Hand the diff to src/anthropic.js, which calls Claude and returns
 *      a structured report object.
 *   6. Render the report with src/render.js — terminal by default, JSON
 *      with --json, optional Markdown side-output with --md.
 *
 * Every error path prints to stderr and exits with code 0 — the tool is
 * advisory and never blocks the user's workflow. See CLAUDE.md for the
 * full set of load-bearing invariants.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import dotenv from 'dotenv';
import { getDiff } from './git.js';
import { auditDiff } from './anthropic.js';
import { renderTerminal, renderJson, renderMarkdown } from './render.js';
import { printBanner, printAnalyzing } from './banner.js';

// Default Claude model. Override with --model. Sonnet 4.6 is the cost/quality
// sweet spot for code review; Opus is more thorough but slower and pricier.
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Absolute path to the CLI's install directory (one level above src/). Used
// to locate the bundled .env file regardless of where the user runs from.
const INSTALL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Run a single audit invocation end-to-end.
 *
 * @param {string[]} argv  process.argv passed straight from bin/cli-auditor.js
 *                         — commander handles the standard [node, script, ...]
 *                         layout.
 * @returns {Promise<void>} Resolves when the report has been printed (and
 *                          optionally written to disk). Always exits the
 *                          process with code 0 before returning to the caller.
 */
export async function main(argv) {
  // dotenv loads variables from .env into process.env. We call it twice:
  //   1. cwd .env  — lets a project keep its own ANTHROPIC_API_KEY.
  //   2. install-dir .env — fallback so a globally-linked CLI still has a key
  //      when run from any directory.
  // dotenv does NOT overwrite already-set variables, so the cwd file wins,
  // then the install-dir file fills in anything missing, and existing real
  // env vars (set by the shell) outrank both.
  dotenv.config();
  dotenv.config({ path: resolve(INSTALL_DIR, '.env') });

  // Build the commander program. Each .option() declares one CLI flag —
  // the boolean flags (--staged etc.) are mutually exclusive and enforced
  // manually below; commander has .conflicts() but the manual check gives
  // a friendlier error message.
  const program = new Command();
  program
    .name('cli-auditor')
    .description('Audit git changes for security, bugs, and structural issues using Claude.')
    .option('--staged', 'Audit staged changes (default)')
    .option('--unstaged', 'Audit unstaged working-tree changes')
    .option('--commit <sha>', 'Audit a single commit')
    .option('--branch <name>', 'Audit changes on the current branch since it diverged from <name>')
    .option('--model <id>', 'Anthropic model to use', DEFAULT_MODEL)
    .option('--max-tokens <n>', 'Max tokens for the API response', (v) => parseInt(v, 10), 4096)
    .option('--json', 'Print the raw JSON report instead of the formatted output')
    .option('--md <path>', 'Also write a Markdown report to the given path')
    .parse(argv);

  const opts = program.opts();

  // The banner goes to stdout, so it would corrupt JSON output piped into
  // jq or other tools. Suppress it whenever the user asked for machine output.
  if (!opts.json) printBanner();

  // Resolve which diff scope to ask git for. Default is "staged" — the
  // intended "before you commit" workflow. The other three flags swap in
  // a different scope and (for commit/branch) capture a ref.
  let scope = 'staged';
  let ref;
  const scopeFlags = [opts.staged, opts.unstaged, opts.commit, opts.branch].filter(Boolean).length;
  if (scopeFlags > 1) {
    // More than one scope flag was supplied — bail before doing any work.
    console.error('Error: --staged, --unstaged, --commit, and --branch are mutually exclusive.');
    process.exit(0);
  }
  if (opts.unstaged) scope = 'unstaged';
  else if (opts.commit) {
    scope = 'commit';
    ref = opts.commit;
  } else if (opts.branch) {
    scope = 'branch';
    ref = opts.branch;
  }

  // Pull the diff text and list of changed files. getDiff also asserts we
  // are inside a git repo and surfaces a friendly error if not.
  let diffResult;
  try {
    diffResult = getDiff({ scope, ref });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(0);
  }

  // Empty diff → nothing to audit. Skip the API call entirely so the user
  // doesn't burn tokens on a no-op run.
  if (!diffResult.diff) {
    console.log(`No changes to audit (scope: ${scope}${ref ? ` ${ref}` : ''}).`);
    process.exit(0);
  }

  // Tell the user we're about to make a network call. The Claude request
  // typically takes 5–15 seconds; without this line the CLI would just sit
  // silent. Same JSON-mode suppression rule as the banner.
  if (!opts.json) {
    printAnalyzing({ fileCount: diffResult.files.length, scope, model: opts.model });
  }

  // Hand off to the API layer. This is the only place we make a network
  // call. The returned object follows the schema declared in src/prompt.js.
  let report;
  try {
    report = await auditDiff({
      diff: diffResult.diff,
      files: diffResult.files,
      model: opts.model,
      maxTokens: opts.maxTokens,
    });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(0);
  }

  // Render to stdout. JSON mode emits exactly one parseable JSON document
  // (no banner, no analyzing line) so callers can pipe it into jq.
  if (opts.json) {
    console.log(renderJson(report));
  } else {
    console.log(renderTerminal(report));
  }

  // Optional side-output: a Markdown file suitable for pasting into a PR
  // description or commit message. Independent of stdout — both happen if
  // both --json and --md are set, except we skip the "wrote file" notice
  // in JSON mode to keep stdout clean.
  if (opts.md) {
    try {
      writeFileSync(opts.md, renderMarkdown(report), 'utf8');
      if (!opts.json) console.log(`Markdown report written to ${opts.md}`);
    } catch (err) {
      console.error(`Failed to write Markdown report: ${err.message}`);
    }
  }

  // Always exit 0. See module header.
  process.exit(0);
}
