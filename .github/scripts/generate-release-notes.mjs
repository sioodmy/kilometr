#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    tag: process.env.TAG || '',
    from: '',
    output: '',
    shaFile: '',
    repo: process.env.GITHUB_REPOSITORY || 'sioodmy/kilometr',
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tag' && args[i + 1]) {
      params.tag = args[++i];
    } else if (args[i] === '--from' && args[i + 1]) {
      params.from = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      params.output = args[++i];
    } else if (args[i] === '--sha-file' && args[i + 1]) {
      params.shaFile = args[++i];
    } else if (args[i] === '--repo' && args[i + 1]) {
      params.repo = args[++i];
    }
  }

  return params;
}

function runGit(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function findPreviousTag(currentTag) {
  const allTagsOutput = runGit('git tag -l "v*" --sort=-v:refname');
  if (!allTagsOutput) return '';
  const tags = allTagsOutput.split('\n').map((t) => t.trim()).filter(Boolean);

  if (!currentTag) {
    return tags[0] || '';
  }

  const currentIndex = tags.indexOf(currentTag);
  if (currentIndex >= 0 && currentIndex + 1 < tags.length) {
    return tags[currentIndex + 1];
  }

  // Jeśli currentTag nie ma jeszcze w tagach lokalnych (np. release tworzony na bieżącym HEAD)
  const remaining = tags.filter((t) => t !== currentTag);
  return remaining[0] || '';
}

function getCommits(fromTag, toRef) {
  const range = fromTag ? `${fromTag}..${toRef}` : toRef;
  const rawLog = runGit(`git log ${range} --pretty=format:"%H%x1f%h%x1f%s%x1f%b%x1e"`);
  if (!rawLog) return [];

  const records = rawLog.split('\x1e').map((r) => r.trim()).filter(Boolean);
  const commits = [];

  for (const record of records) {
    const parts = record.split('\x1f');
    if (parts.length < 3) continue;

    const [fullHash, shortHash, subject, body = ''] = parts;
    const cleanSubject = subject.trim();

    // Pomijamy commity złączające (merge commits) oraz puste / wulgarne
    if (/^Merge\b/i.test(cleanSubject)) continue;
    if (/^(chuj|wip|temp|test)$/i.test(cleanSubject)) continue;

    commits.push({
      fullHash,
      shortHash,
      subject: cleanSubject,
      body: body.trim(),
    });
  }

  return commits;
}

const CATEGORIES = [
  { key: 'breaking', title: '💥 Zmiany przełomowe (Breaking Changes)' },
  { key: 'feat', title: '🚀 Nowości i ulepszenia' },
  { key: 'fix', title: '🐛 Poprawki błędów' },
  { key: 'perf', title: '⚡ Wydajność i optymalizacje' },
  { key: 'refactor', title: '🛠️ Refaktoryzacja' },
  { key: 'style', title: '🎨 UI i wygląd' },
  { key: 'docs', title: '📖 Dokumentacja' },
  { key: 'ci', title: '🔧 CI/CD i konfiguracja' },
  { key: 'chore', title: '📦 Zależności i prace pomocnicze' },
  { key: 'other', title: '🔍 Inne zmiany' },
];

function categorizeCommits(commits) {
  const groups = new Map();
  for (const cat of CATEGORIES) {
    groups.set(cat.key, []);
  }

  const conventionalRegex = /^([a-zA-Z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

  for (const commit of commits) {
    const isBreakingByBody =
      /BREAKING CHANGE:/i.test(commit.body) || /BREAKING-CHANGE:/i.test(commit.body);
    const match = commit.subject.match(conventionalRegex);

    if (match) {
      const [, rawType, rawScope, bang, description] = match;
      const type = rawType.toLowerCase();
      const scope = rawScope ? rawScope.trim() : null;
      const isBreaking = Boolean(bang) || isBreakingByBody;

      const item = {
        scope,
        description: description.trim(),
        shortHash: commit.shortHash,
        fullHash: commit.fullHash,
      };

      if (isBreaking) {
        groups.get('breaking').push(item);
      } else if (groups.has(type)) {
        groups.get(type).push(item);
      } else if (type === 'test') {
        groups.get('chore').push(item);
      } else if (type === 'build') {
        groups.get('ci').push(item);
      } else {
        groups.get('other').push(item);
      }
    } else {
      if (isBreakingByBody) {
        groups.get('breaking').push({
          scope: null,
          description: commit.subject,
          shortHash: commit.shortHash,
          fullHash: commit.fullHash,
        });
      } else {
        groups.get('other').push({
          scope: null,
          description: commit.subject,
          shortHash: commit.shortHash,
          fullHash: commit.fullHash,
        });
      }
    }
  }

  return groups;
}

function formatReleaseNotes(params, groups, fromTag, commitsCount) {
  const { tag, repo } = params;
  const lines = [];

  lines.push(`## Wydanie Kilometr ${tag}`);
  lines.push('');

  const today = new Date().toISOString().split('T')[0];
  lines.push(`_Data wydania: ${today}_`);
  lines.push('');

  let hasAnyEntries = false;

  for (const cat of CATEGORIES) {
    const items = groups.get(cat.key) || [];
    if (items.length === 0) continue;

    hasAnyEntries = true;
    lines.push(`### ${cat.title}`);
    lines.push('');

    for (const item of items) {
      const commitLink = `[\`${item.shortHash}\`](https://github.com/${repo}/commit/${item.fullHash})`;
      if (item.scope) {
        lines.push(`- **${item.scope}**: ${item.description} (${commitLink})`);
      } else {
        lines.push(`- ${item.description} (${commitLink})`);
      }
    }
    lines.push('');
  }

  if (!hasAnyEntries) {
    lines.push('_Brak zarejestrowanych zmian w tej wersji._');
    lines.push('');
  }

  // Sekcja pobierania
  lines.push('### 📱 Instalacja (Android)');
  lines.push('');
  lines.push(
    `Pobierz uniwersalną paczkę **\`kilometr-${tag}.apk\`** kompatybilną z architekturami \`arm64-v8a\`, \`armeabi-v7a\` oraz \`x86_64\`.`
  );
  lines.push('');
  lines.push(
    `- [Pobierz kilometr-${tag}.apk](https://github.com/${repo}/releases/download/${tag}/kilometr-${tag}.apk)`
  );

  if (params.shaFile) {
    try {
      const shaContent = readFileSync(params.shaFile, 'utf8').trim();
      if (shaContent) {
        lines.push('');
        lines.push('**Suma kontrolna SHA256:**');
        lines.push('```text');
        lines.push(shaContent);
        lines.push('```');
      }
    } catch {
      // Plik SHA może jeszcze nie istnieć przy wstępnym generowaniu
    }
  }

  lines.push('');
  lines.push('---');
  if (fromTag) {
    lines.push(
      `🔎 **Pełna lista zmian**: [${fromTag}...${tag}](https://github.com/${repo}/compare/${fromTag}...${tag}) (${commitsCount} commitów)`
    );
  } else {
    lines.push(`🔎 Pierwsze zarejestrowane wydanie tagu (${commitsCount} commitów)`);
  }

  return lines.join('\n');
}

function main() {
  const params = parseArgs();

  if (!params.tag) {
    params.tag = runGit('git describe --tags --exact-match 2>/dev/null') || 'v-latest';
  }

  const fromTag = params.from || findPreviousTag(params.tag);
  const targetRef = 'HEAD';

  const commits = getCommits(fromTag, targetRef);
  const groups = categorizeCommits(commits);
  const markdown = formatReleaseNotes(params, groups, fromTag, commits.length);

  if (params.output) {
    writeFileSync(params.output, markdown, 'utf8');
    console.log(`Wygenerowano release notes do: ${params.output}`);
  } else {
    console.log(markdown);
  }
}

main();
