/**
 * src/git.js — git diff resolution.
 *
 * Single export: getDiff(). Given a scope ("staged" | "unstaged" | "commit"
 * | "branch") and an optional ref, this module shells out to git and returns
 * the raw diff text plus the list of changed file paths.
 *
 * Security note: git is invoked via execFileSync with an argv array, never
 * via a shell string. That means user-controlled refs (--commit <sha>,
 * --branch <name>) cannot inject shell metacharacters — they are passed as
 * positional arguments to the git binary directly. Do not "improve" this by
 * switching to exec() with template literals.
 */
import { execFileSync } from 'node:child_process';

// Shared options for every git invocation.
//   cwd       — run in the user's current shell directory (where they
//               typed `cli-auditor`), NOT in the CLI install dir.
//   encoding  — return stdout/stderr as strings instead of Buffers.
//   maxBuffer — 10 MB cap on stdout. Diffs can be large; this prevents the
//               default 1 MB limit from truncating real-world reviews.
//   stdio     — ignore stdin (we never feed git anything), pipe stdout and
//               stderr back so we can inspect them.
const EXEC_OPTS = {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
};

/**
 * Run `git` with the given argv array and return its stdout.
 *
 * Wraps execFileSync to translate the most common failure modes into
 * friendly Error messages. Any unrecognized git failure is re-thrown with
 * git's own stderr text so the user can see what actually went wrong.
 *
 * @param {string[]} args  Arguments to pass to git, e.g. ['diff', '--staged'].
 * @returns {string}       git's stdout, decoded as UTF-8.
 * @throws {Error}         On any non-zero exit or missing git binary.
 */
function runGit(args) {
  try {
    return execFileSync('git', args, EXEC_OPTS);
  } catch (err) {
    // ENOENT means the OS couldn't find the `git` executable at all.
    if (err.code === 'ENOENT') {
      throw new Error('git is not installed or not on PATH.');
    }
    const stderr = (err.stderr || '').toString().trim();
    // Git prints "fatal: not a git repository" when run outside a worktree.
    // assertInRepo() should have caught this earlier, but we double-check
    // here as a defensive belt-and-braces.
    if (stderr.toLowerCase().includes('not a git repository')) {
      throw new Error(`Not a git repository: ${process.cwd()}`);
    }
    throw new Error(stderr || err.message);
  }
}

/**
 * Verify that the current working directory lives inside a git repository.
 *
 * We use a separate `git rev-parse --is-inside-work-tree` probe instead of
 * relying on the `git diff` call to fail informatively. Reason: when run
 * outside a repo, `git diff --staged` falls back to `--no-index` mode and
 * dumps several screens of unrelated help text instead of saying "not a git
 * repository". Doing the check up-front lets us surface a one-line error.
 *
 * @throws {Error}  If git is missing or cwd is not a working tree.
 */
function assertInRepo() {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], EXEC_OPTS);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('git is not installed or not on PATH.');
    }
    throw new Error(`Not a git repository: ${process.cwd()}`);
  }
}

/**
 * Map a high-level scope name to the argv that selects that diff in git.
 *
 *   staged   → git diff --staged           (changes in the index, pre-commit)
 *   unstaged → git diff                    (changes in the working tree)
 *   commit   → git diff <sha>^!            (the one specified commit)
 *   branch   → git diff <name>...HEAD      (branch divergence vs. <name>)
 *
 * The `^!` suffix is git shorthand for "the commit and all its parents
 * excluded", i.e. just the diff that commit introduced. The `A...B` form
 * gives the symmetric-difference style diff used by GitHub PR views.
 *
 * @param {string} scope  One of 'staged' | 'unstaged' | 'commit' | 'branch'.
 * @param {string} [ref]  Required for 'commit' and 'branch'; ignored otherwise.
 * @returns {string[]}    argv array starting with 'diff'.
 * @throws {Error}        If a required ref is missing or scope is unknown.
 */
function diffArgsFor(scope, ref) {
  switch (scope) {
    case 'staged':
      return ['diff', '--staged'];
    case 'unstaged':
      return ['diff'];
    case 'commit':
      if (!ref) throw new Error('--commit requires a commit ref.');
      return ['diff', `${ref}^!`];
    case 'branch':
      if (!ref) throw new Error('--branch requires a branch name.');
      return ['diff', `${ref}...HEAD`];
    default:
      throw new Error(`Unknown diff scope: ${scope}`);
  }
}

/**
 * Resolve the requested diff and return both the patch text and the list
 * of changed file paths.
 *
 * Two git invocations: one to fetch the actual unified diff (for Claude to
 * read), and a second `--name-only` pass over the same scope to enumerate
 * the touched files (for the analyzing message and Claude's context).
 *
 * @param {Object}  [opts]
 * @param {string}  [opts.scope='staged']  Which diff to fetch.
 * @param {string}  [opts.ref]             Commit SHA or branch name when scope
 *                                         is 'commit' or 'branch'.
 * @returns {{diff: string, files: string[], scope: string, ref?: string}}
 *          The trimmed diff text, an array of file paths (empty when the
 *          diff is empty), and the scope/ref echoed back for logging.
 */
export function getDiff({ scope = 'staged', ref } = {}) {
  assertInRepo();
  const args = diffArgsFor(scope, ref);
  const diff = runGit(args).trim();
  // Reuse the same scope arguments but with --name-only inserted after the
  // 'diff' subcommand. Splice at index 1 so the structure is:
  //   ['diff', '--name-only', '--staged']  /  ['diff', '--name-only']  /  etc.
  const filesOut = runGit([args[0], '--name-only', ...args.slice(1)]).trim();
  // Split on either LF or CRLF so the parsing works on Windows shells too.
  const files = filesOut ? filesOut.split(/\r?\n/) : [];
  return { diff, files, scope, ref };
}
