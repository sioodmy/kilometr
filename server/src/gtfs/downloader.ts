import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { config } from '../config';

interface Candidate {
  id: number;
  url: string;
  filename?: string;
  effectiveDate?: number;
}

/** Parse DDMMYYYY from snapshot filenames like OtwartyWroclaw_rozklad_jazdy_GTFS_19092026.zip */
function parseEffectiveDate(name: string): number | null {
  const match = /(\d{2})(\d{2})(\d{4})(?!\d)/.exec(name);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return Date.UTC(year, month - 1, day);
}

export async function ensureGtfsData(): Promise<string> {
  const extractedDir = path.join(config.dataDir, config.gtfs.extractedDir);
  const stopsFile = path.join(extractedDir, 'stops.txt');
  const zipFile = path.join(config.dataDir, config.gtfs.cacheFile);

  if (fs.existsSync(stopsFile)) {
    console.log('[GTFS] Using existing extracted GTFS dataset at:', extractedDir);
    return extractedDir;
  }

  fs.mkdirSync(config.dataDir, { recursive: true });

  if (fs.existsSync(zipFile)) {
    console.log('[GTFS] Found cached zip, extracting:', zipFile);
    extractZip(zipFile, extractedDir);
    return extractedDir;
  }

  console.log('[GTFS] No local data found. Resolving latest Wrocław GTFS archive from Open Data portal...');
  const downloadUrl = await discoverBestArchiveUrl();
  console.log('[GTFS] Downloading GTFS archive from:', downloadUrl);

  const res = await fetch(downloadUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  });

  if (!res.ok) {
    throw new Error(`Failed to download GTFS archive: HTTP ${res.status} ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(zipFile, buffer);
  console.log('[GTFS] Downloaded', buffer.length, 'bytes. Extracting...');

  extractZip(zipFile, extractedDir);
  return extractedDir;
}

function extractZip(zipPath: string, destDir: string) {
  fs.mkdirSync(destDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);
  console.log('[GTFS] Extracted GTFS successfully to:', destDir);
}

async function discoverBestArchiveUrl(): Promise<string> {
  try {
    const res = await fetch(config.gtfs.catalogueUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = (await res.json()) as { pliki?: number[] };
      const fileIds = Array.isArray(data.pliki) ? data.pliki.slice(0, 5) : [];

      const candidates: Candidate[] = [];
      const now = Date.now();

      for (const id of fileIds) {
        const url = `${config.gtfs.downloadBase}/${id}/`;
        try {
          const headRes = await fetch(url, {
            method: 'HEAD',
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(5000),
          });
          const disposition = headRes.headers.get('content-disposition') || '';
          const filenameMatch = /filename="?([^"]+)"?/.exec(disposition);
          const filename = filenameMatch ? filenameMatch[1] : '';
          const effectiveDate = parseEffectiveDate(filename) || 0;
          candidates.push({ id, url, filename, effectiveDate });
        } catch {
          // ignore head failure on candidate
        }
      }

      // Pick latest effective date that is <= now, or closest
      const inForce = candidates
        .filter((c) => c.effectiveDate && c.effectiveDate <= now)
        .sort((a, b) => (b.effectiveDate || 0) - (a.effectiveDate || 0));

      if (inForce.length > 0) {
        console.log(`[GTFS] Selected active in-force timetable: ${inForce[0].filename}`);
        return inForce[0].url;
      }

      if (candidates.length > 0) {
        return candidates[0].url;
      }
    }
  } catch (err) {
    console.warn('[GTFS] Discovery failed, falling back to direct URL:', err);
  }

  return config.gtfs.fallbackDirectUrl;
}
