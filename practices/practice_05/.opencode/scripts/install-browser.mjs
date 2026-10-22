import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { root, tools, browserPath, libraryPath } from './paths.mjs';

const require = createRequire(path.join(tools, 'package.json'));
const cli = path.join(path.dirname(require.resolve('playwright-core/package.json')), 'cli.js');
const result = spawnSync(process.execPath, [cli, 'install', '--no-shell', 'chromium'], {
  stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserPath },
});
if (result.error) console.error(result.error.message);
if (result.status !== 0) process.exit(result.status ?? 1);

process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
const { chromium } = await import('playwright-core');
const libraryEnv = { ...process.env, LD_LIBRARY_PATH: [libraryPath, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
function missingLibraries() {
  const check = spawnSync('ldd', [chromium.executablePath()], { env: libraryEnv, encoding: 'utf8' });
  return (check.stdout ?? '').split('\n').filter(line => line.includes('not found'));
}
if (process.platform === 'linux' && missingLibraries().length) {
  // Extract missing Ubuntu/Debian libraries locally, without sudo or system changes.
  const packages = new Set();
  const mapping = { 'libnspr4.so': 'libnspr4', 'libnss3.so': 'libnss3', 'libnssutil3.so': 'libnss3', 'libsmime3.so': 'libnss3', 'libasound.so.2': 'libasound2t64' };
  for (const line of missingLibraries()) {
    const library = line.trim().split(/\s+/)[0];
    if (!mapping[library]) throw new Error(`Missing ${library}. Install the Chromium system dependencies for your OS.`);
    packages.add(mapping[library]);
  }
  const downloadDir = path.join(tools, '.cache', 'debs');
  const extractDir = path.join(tools, '.cache', 'system-libs');
  mkdirSync(downloadDir, { recursive: true });
  mkdirSync(extractDir, { recursive: true });
  const config = JSON.parse(readFileSync(path.join(root, 'opencode.json'), 'utf8'));
  const proxy = process.env.CONTEXT7_WINDOWS_PROXY ?? config.mcp.servers.context7.environment?.CONTEXT7_WINDOWS_PROXY;
  const windowsCurl = '/mnt/c/Windows/System32/curl.exe';
  if (proxy && existsSync(windowsCurl)) {
    const plan = spawnSync('apt-get', ['--print-uris', 'download', ...packages], { encoding: 'utf8' });
    if (plan.status !== 0) throw new Error(plan.stderr || 'Could not read apt package metadata.');
    const entries = [...plan.stdout.matchAll(/'([^']+)' (\S+) (\d+) (\w+):([0-9a-f]+)/g)];
    if (entries.length !== packages.size) throw new Error('Incomplete apt download plan.');
    for (const [, url, file, size, algorithm, hash] of entries) {
      const download = spawnSync(windowsCurl, [
        '--silent', '--show-error', '--fail', '--location', '--proxy', proxy,
        '--connect-timeout', '8', '--max-time', '45', url.replace(/^http:/, 'https:'),
      ], { maxBuffer: 16 * 1024 * 1024, timeout: 50000 });
      if (download.status !== 0) throw new Error(download.stderr?.toString() || 'Package download failed.');
      if (download.stdout.length !== Number(size) || createHash(algorithm.toLowerCase()).update(download.stdout).digest('hex') !== hash) {
        throw new Error(`Package checksum mismatch: ${file}`);
      }
      writeFileSync(path.join(downloadDir, file), download.stdout);
    }
  } else {
    const download = spawnSync('apt-get', ['-o', 'Acquire::ForceIPv4=true', '-o', 'Acquire::Retries=1',
      '-o', 'Acquire::http::Timeout=20', 'download', ...packages], { cwd: downloadDir, stdio: 'inherit', timeout: 120000 });
    if (download.status !== 0) throw new Error('Could not download local Chromium libraries from the configured apt repositories.');
  }
  for (const file of readdirSync(downloadDir).filter(file => file.endsWith('.deb'))) {
    const unpack = spawnSync('dpkg-deb', ['--extract', path.join(downloadDir, file), extractDir], { stdio: 'inherit' });
    if (unpack.status !== 0) throw new Error(`Could not extract ${file}.`);
  }
  if (missingLibraries().length) throw new Error(missingLibraries().join('\n'));
  console.log('OK: недостающие библиотеки Chromium распакованы в локальный кэш.');
}
