import { execFileSync } from 'node:child_process';

const EXEC_OPTS = {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
};

function runGit(args) {
  try {
    return execFileSync('git', args, EXEC_OPTS);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error('git is not installed or not on PATH.');
    }
    const stderr = (err.stderr || '').toString().trim();
    if (stderr.toLowerCase().includes('not a git repository')) {
      throw new Error(`Not a git repository: ${process.cwd()}`);
    }
    throw new Error(stderr || err.message);
  }
}

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

export function getDiff({ scope = 'staged', ref } = {}) {
  assertInRepo();
  const args = diffArgsFor(scope, ref);
  const diff = runGit(args).trim();
  const filesOut = runGit([args[0], '--name-only', ...args.slice(1)]).trim();
  const files = filesOut ? filesOut.split(/\r?\n/) : [];
  return { diff, files, scope, ref };
}
