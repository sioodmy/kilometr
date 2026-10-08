#!/usr/bin/env node
// Wylicza następną wersję (semver) na podstawie conventional commitów
// od ostatniego tagu `v*` do HEAD. Wynik trafia na stdout jako `vX.Y.Z`.
//   - breaking (`!` lub `BREAKING CHANGE:`)  -> major
//   - `feat:`                                -> minor
//   - wszystko inne                          -> patch
import { execSync } from 'node:child_process';

function git(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function latestTag() {
  return (
    git('git tag -l "v*" --sort=-v:refname')
      .split('\n')
      .map((tag) => tag.trim())
      .filter(Boolean)[0] || ''
  );
}

function commitsSince(fromTag) {
  const range = fromTag ? `${fromTag}..HEAD` : 'HEAD';
  const raw = git(`git log ${range} --pretty=format:"%s%x1f%b%x1e"`);
  if (!raw) return [];

  return raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [subject = '', body = ''] = record.split('\x1f');
      return { subject: subject.trim(), body: body.trim() };
    })
    .filter((commit) => !/^Merge\b/i.test(commit.subject));
}

function parseVersion(tag) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag || '');
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function saveBump(current, next) {
  const rank = { patch: 0, minor: 1, major: 2 };
  return rank[next] > rank[current] ? next : current;
}

function main() {
  const from = latestTag();
  const [major, minor, patch] = parseVersion(from);

  let bump = 'patch';
  const conventional = /^([a-zA-Z]+)(?:\([^)]+\))?(!)?:/;

  for (const commit of commitsSince(from)) {
    const breaking =
      /^[a-zA-Z]+(?:\([^)]+\))?!:/i.test(commit.subject) ||
      /BREAKING[ -]CHANGE:/i.test(commit.body);
    if (breaking) {
      bump = saveBump(bump, 'major');
      continue;
    }
    const match = conventional.exec(commit.subject);
    if (match && match[1].toLowerCase() === 'feat') {
      bump = saveBump(bump, 'minor');
    }
  }

  let next;
  if (bump === 'major') next = [major + 1, 0, 0];
  else if (bump === 'minor') next = [major, minor + 1, 0];
  else next = [major, minor, patch + 1];

  process.stdout.write(`v${next.join('.')}`);
}

main();
