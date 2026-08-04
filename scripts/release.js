#!/usr/bin/env node
'use strict';

/**
 * Release automation for ClipSend.
 *
 * Usage:
 *   npm run release:patch                          # bump patch, changelog entry, commit, tag
 *   npm run release:patch -- --message "Title"     # use a descriptive changelog title
 *   npm run release:patch -- --dry-run             # print what would happen, change nothing
 *   node scripts/release.js --check-tag v1.8.19    # exit 1 unless tag matches package.json (CI guard)
 *
 * The script keeps package.json, package-lock.json and renderer/changelog-data.js
 * in sync, then creates a commit and an annotated tag. Pushing is intentionally
 * left to the caller (e.g. `git push origin main && git push origin vX.Y.Z`) so
 * nothing is published without an explicit step.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const LOCK_PATH = path.join(ROOT, 'package-lock.json');
const CHANGELOG_PATH = path.join(ROOT, 'renderer', 'changelog-data.js');

/** 1.8.18 -> 1.8.19; 1.8 -> 1.8.1; v1.8.18 -> 1.8.19 */
function bumpPatch(version) {
  const cleaned = String(version).replace(/^v/i, '');
  const parts = cleaned.split('.');
  while (parts.length < 3) parts.push('0');
  const [major, minor, patch] = parts.map((p) => parseInt(p, 10) || 0);
  return `${major}.${minor}.${patch + 1}`;
}

/** 'v1.8.19' or '1.8.19' vs '1.8.19' -> true */
function versionsMatch(tag, pkgVersion) {
  const normalized = String(tag).replace(/^v/i, '');
  return normalized === String(pkgVersion);
}

/**
 * Build a changelog entry object shape matching renderer/changelog-data.js.
 * `date` defaults to the current month + year (e.g. "August 2026").
 */
function buildChangelogEntry(version, summary, date) {
  const safeSummary = escapeJsString(summary || '');
  const title = `v${version}${safeSummary ? `: ${safeSummary}` : ''}`;
  const change = safeSummary || `Release ${version}`;
  const month = date || new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  return {
    version: title,
    date: month,
    changes: [change]
  };
}

/** Serialize a changelog entry the same way the data file formats entries. */
function serializeChangelogEntry(entry, eol) {
  const changes = entry.changes.map((c) => `      "${c}"`).join(`,${eol}`);
  return [
    '  {',
    `    "version": "${entry.version}",`,
    `    "date": "${entry.date}",`,
    '    "changes": [',
    changes,
    '    ]',
    '  },'
  ].join(eol);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Detect the dominant line ending of a text file (repo files are CRLF). */
function detectEol(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

/** Serialize JSON preserving the target file's line endings. */
function serializeJson(obj, eol) {
  return `${JSON.stringify(obj, null, 2).replace(/\n/g, eol)}${eol}`;
}

/** Escape a string as the body of a JS/JSON string literal. */
function escapeJsString(s) {
  return JSON.stringify(String(s)).slice(1, -1);
}

function git(args, opts) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function gitStatus() {
  // Untracked files (e.g. a stray updater.log from the test suite) must not
  // block a release — only tracked modifications and deletions matter.
  const out = git(['status', '--porcelain', '--untracked-files=no']);
  return out.trim().split('\n').filter(Boolean);
}

function main(argv) {
  const args = argv.slice(2);

  // CI guard: fail unless the pushed tag matches package.json.
  const checkTagIdx = args.indexOf('--check-tag');
  if (checkTagIdx !== -1) {
    const tag = args[checkTagIdx + 1];
    if (!tag) {
      console.error('--check-tag requires a tag argument (e.g. v1.8.19)');
      process.exit(2);
    }
    const pkg = readJson(PKG_PATH);
    if (!versionsMatch(tag, pkg.version)) {
      console.error(
        `::error::Tag ${tag} does not match package.json version ${pkg.version}. ` +
          `Bump the version with 'npm run release:patch' before tagging.`
      );
      process.exit(1);
    }
    console.log(`OK: tag ${tag} matches package.json version ${pkg.version}.`);
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');
  const messageIdx = args.indexOf('--message');
  const summary = messageIdx !== -1 && args[messageIdx + 1] ? args[messageIdx + 1] : '';

  const pkg = readJson(PKG_PATH);
  const nextVersion = bumpPatch(pkg.version);
  const entry = buildChangelogEntry(nextVersion, summary);
  const eol = (() => {
    try {
      return fs.readFileSync(CHANGELOG_PATH, 'utf8').includes('\r\n') ? '\r\n' : '\n';
    } catch (e) {
      return '\n';
    }
  })();
  const commitMessage = `Release v${nextVersion}${summary ? `: ${summary}` : ''}`;
  const tagName = `v${nextVersion}`;

  if (dryRun) {
    console.log(`[dry-run] Would bump version ${pkg.version} -> ${nextVersion}`);
    console.log(`[dry-run] Would prepend changelog entry: ${entry.version}`);
    console.log(`[dry-run] Would commit: "${commitMessage}"`);
    console.log(`[dry-run] Would tag: ${tagName}`);
    process.exit(0);
  }

  // Safety: refuse to run on a dirty tree so the release commit is predictable.
  const dirty = gitStatus();
  if (dirty.length > 0) {
    console.error(`Release aborted: working tree is not clean:\n${dirty.join('\n')}`);
    console.error('Commit or stash these changes first, or use --dry-run to preview.');
    process.exit(1);
  }

  // 1. Bump package.json + package-lock.json (preserving each file's EOL).
  pkg.version = nextVersion;
  fs.writeFileSync(PKG_PATH, serializeJson(pkg, detectEol(fs.readFileSync(PKG_PATH, 'utf8'))));

  try {
    const lock = readJson(LOCK_PATH);
    lock.version = nextVersion;
    if (lock.packages && lock.packages['']) lock.packages[''].version = nextVersion;
    fs.writeFileSync(LOCK_PATH, serializeJson(lock, detectEol(fs.readFileSync(LOCK_PATH, 'utf8'))));
  } catch (e) {
    console.error(`Warning: could not update package-lock.json (${e.message}).`);
  }

  // 2. Prepend the changelog entry.
  const changelog = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  const header = 'window.changelogData = [';
  const insertAt = changelog.indexOf(header);
  if (insertAt === -1) {
    console.error('Release aborted: could not find changelog header in renderer/changelog-data.js');
    process.exit(1);
  }
  const updatedChangelog =
    changelog.slice(0, insertAt + header.length) +
    eol +
    serializeChangelogEntry(entry, eol) +
    changelog.slice(insertAt + header.length);
  fs.writeFileSync(CHANGELOG_PATH, updatedChangelog);

  // 3. Commit.
  git(['add', PKG_PATH, LOCK_PATH, CHANGELOG_PATH]);
  git(['commit', '-m', commitMessage]);

  // 4. Tag.
  git(['tag', '-a', tagName, '-m', commitMessage]);

  console.log(`Released v${nextVersion} (commit + annotated tag ${tagName}).`);
  console.log('Recommended flow:');
  console.log(`  1. git push origin <branch>`);
  console.log('  2. Open & merge the PR (squash) once CI passes');
  console.log(`  3. git push origin ${tagName}   # release workflow builds from the tag`);
  console.log('Note: push the tag only after the merge so the release points at main;');
  console.log("if the branch changed after tagging, re-create the tag on main before pushing.");
}

module.exports = { bumpPatch, versionsMatch, buildChangelogEntry, serializeChangelogEntry, serializeJson, escapeJsString, detectEol };

if (require.main === module) {
  main(process.argv);
}
