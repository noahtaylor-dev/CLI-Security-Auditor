import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import dotenv from 'dotenv';
import { getDiff } from './git.js';
import { auditDiff } from './anthropic.js';
import { renderTerminal, renderJson, renderMarkdown } from './render.js';
import { printBanner, printAnalyzing } from './banner.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const INSTALL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function main(argv) {
  // Load .env from cwd first (lets per-project overrides win because dotenv
  // does not overwrite existing vars), then from the CLI's install dir so the
  // tool works no matter which repo the user runs it from.
  dotenv.config();
  dotenv.config({ path: resolve(INSTALL_DIR, '.env') });

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

  if (!opts.json) printBanner();

  let scope = 'staged';
  let ref;
  const scopeFlags = [opts.staged, opts.unstaged, opts.commit, opts.branch].filter(Boolean).length;
  if (scopeFlags > 1) {
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

  let diffResult;
  try {
    diffResult = getDiff({ scope, ref });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(0);
  }

  if (!diffResult.diff) {
    console.log(`No changes to audit (scope: ${scope}${ref ? ` ${ref}` : ''}).`);
    process.exit(0);
  }

  if (!opts.json) {
    printAnalyzing({ fileCount: diffResult.files.length, scope, model: opts.model });
  }

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

  if (opts.json) {
    console.log(renderJson(report));
  } else {
    console.log(renderTerminal(report));
  }

  if (opts.md) {
    try {
      writeFileSync(opts.md, renderMarkdown(report), 'utf8');
      if (!opts.json) console.log(`Markdown report written to ${opts.md}`);
    } catch (err) {
      console.error(`Failed to write Markdown report: ${err.message}`);
    }
  }

  process.exit(0);
}
