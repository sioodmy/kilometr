#!/usr/bin/env node
// Wylicza wspólny, ściśle rosnący ANDROID_VERSION_CODE dla Google Play AAB.
//
// Oba workflow budujące AAB (build-apk.yml przez workflow_call na prod oraz
// samodzielny build-aab.yml przez workflow_dispatch) współdzielą jeden licznik
// oparty na sumie ostatnich run_number obu workflowów:
//   counter = latestRun(build-apk.yml) + latestRun(build-aab.yml)
//
// Poprzedni opublikowany kod Play (v1.12.0, build-aab.yml run #68,
// build-apk.yml był na #142 → suma 210) miał versionCode = 701051402.
// Następny run daje sumę >= 211 → versionCode >= 701051411 (+10 na każdy run,
// żeby Play Console nie ostrzegało przy dużych skokach między uploadami).

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PLAY_SEQ_BASE = 211;
export const PLAY_VERSION_CODE_BASE = 701051410;
export const PLAY_ATTEMPT_SLOTS = 10;
export const MIN_PUBLISHED_VERSION_CODE = 701051402;

export function computePlayVersionCode({ apkRunNumber, aabRunNumber, runAttempt }) {
  if (!Number.isInteger(apkRunNumber) || apkRunNumber < 0) {
    throw new Error(`Nieprawidłowy numer runu build-apk.yml: ${apkRunNumber}`);
  }
  if (!Number.isInteger(aabRunNumber) || aabRunNumber < 0) {
    throw new Error(`Nieprawidłowy numer runu build-aab.yml: ${aabRunNumber}`);
  }
  if (!Number.isInteger(runAttempt) || runAttempt < 1 || runAttempt > PLAY_ATTEMPT_SLOTS) {
    throw new Error(
      `Nieprawidłowy GITHUB_RUN_ATTEMPT=${runAttempt} (limit slotów: ${PLAY_ATTEMPT_SLOTS}).`,
    );
  }

  const counter = apkRunNumber + aabRunNumber;
  if (counter < PLAY_SEQ_BASE) {
    throw new Error(
      `Wspólny licznik AAB (${counter} = ${apkRunNumber} + ${aabRunNumber}) jest mniejszy niż baza ${PLAY_SEQ_BASE}.`,
    );
  }

  const versionCode =
    PLAY_VERSION_CODE_BASE + (counter - PLAY_SEQ_BASE) * PLAY_ATTEMPT_SLOTS + runAttempt;

  if (versionCode <= MIN_PUBLISHED_VERSION_CODE) {
    throw new Error(
      `Wyliczony versionCode=${versionCode} nie jest większy niż ostatni opublikowany (${MIN_PUBLISHED_VERSION_CODE}).`,
    );
  }

  return { counter, versionCode };
}

async function fetchLatestRunNumber(repo, workflowFile, token) {
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/runs?per_page=1`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'kilometr-ci',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        throw new Error(`GitHub API ${workflowFile} HTTP ${response.status}`);
      }
      const data = await response.json();
      const latest = Number(data?.workflow_runs?.[0]?.run_number ?? 0);
      if (Number.isInteger(latest) && latest >= 0) {
        return latest;
      }
      throw new Error(`Nieoczekiwany run_number z API dla ${workflowFile}`);
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw lastError;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || '';
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const callerWorkflow = process.env.CALLER_WORKFLOW || 'build-aab.yml';
  const currentRunNumber = Number(process.env.GITHUB_RUN_NUMBER || '0');
  const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || '1');

  if (!repo || currentRunNumber <= 0) {
    throw new Error('Brak GITHUB_REPOSITORY lub GITHUB_RUN_NUMBER w środowisku.');
  }

  let apkRunNumber;
  let aabRunNumber;

  if (callerWorkflow === 'build-apk.yml') {
    apkRunNumber = currentRunNumber;
    aabRunNumber = await fetchLatestRunNumber(repo, 'build-aab.yml', token);
  } else {
    apkRunNumber = await fetchLatestRunNumber(repo, 'build-apk.yml', token);
    aabRunNumber = currentRunNumber;
  }

  const { counter, versionCode } = computePlayVersionCode({
    apkRunNumber,
    aabRunNumber,
    runAttempt,
  });

  if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `ANDROID_VERSION_CODE=${versionCode}\n`, 'utf8');
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version_code=${versionCode}\nplay_counter=${counter}\n`,
      'utf8',
    );
  }

  console.log(
    `Play counter=${counter} (build-apk=#${apkRunNumber} + build-aab=#${aabRunNumber}, attempt=${runAttempt}) -> ANDROID_VERSION_CODE=${versionCode}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
