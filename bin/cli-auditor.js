#!/usr/bin/env node
/**
 * cli-auditor — executable entry point.
 *
 * The shebang line above lets this file run directly as `cli-auditor` once
 * `npm link` (or `npm install -g`) has placed it on the user's PATH; the
 * `bin` field in package.json maps the command name to this file.
 *
 * Responsibilities of this entry are deliberately tiny: import the real
 * orchestration function (`main`) from src/cli.js, hand it process.argv,
 * and convert any uncaught rejection into a friendly stderr line.
 *
 * The exit-0 on error is intentional — the whole tool is advisory and never
 * blocks the user's workflow (see CLAUDE.md "Always exits 0").
 */
import { main } from '../src/cli.js';

main(process.argv).catch((err) => {
  // Anything that escapes main() is a programmer error (bad import,
  // unexpected throw). Print the message — never the stack — and still
  // exit cleanly so wrapper scripts don't break.
  console.error(`Unexpected error: ${err.message}`);
  process.exit(0);
});
