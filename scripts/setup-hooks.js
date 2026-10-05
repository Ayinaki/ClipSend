#!/usr/bin/env node
/**
 * Point git at the repository's versioned hooks (.githooks).
 *
 * Hooks are not version controlled by default, so a fresh clone has no
 * commit-msg guard against the Codebuff co-author trailer. Wiring
 * core.hooksPath here makes the tracked .githooks/ directory authoritative.
 * Invoked from npm's `prepare` lifecycle (so plain `npm install` sets it up),
 * and available directly as `npm run setup:hooks`.
 *
 * Every failure is swallowed on purpose: a directory that is not a git work
 * tree (a packaged tarball, CI unpacking a build) must still install cleanly.
 */
const { execFileSync } = require('child_process');

try {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    stdio: ['ignore', 'pipe', 'ignore']
  })
    .toString()
    .trim();

  if (!root) throw new Error('not a git work tree');

  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'ignore']
  });

  console.log('setup-hooks: core.hooksPath -> .githooks');
} catch {
  // Not a git checkout, or git is unavailable. Nothing to set up.
}
