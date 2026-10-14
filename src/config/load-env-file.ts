import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Paths checked in order (first existing file wins for each key). */
export function envFileCandidates(cwd = process.cwd()) {
  return [
    resolve(cwd, '.env'),
    resolve(cwd, 'shared/.env'),
    resolve(cwd, '../shared/.env'),
    '/var/www/givora-api/shared/.env',
  ];
}

/**
 * Load KEY=VALUE pairs from .env files into process.env.
 * Does not override variables already set in the environment (e.g. systemd, PM2 env_file).
 */
export function loadEnvFiles(cwd = process.cwd()) {
  for (const file of envFileCandidates(cwd)) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      if (process.env[key] !== undefined) continue;
      let value = trimmed.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}
