import { spawn } from 'node:child_process';
import path from 'node:path';
import { tools, root, browserPath, libraryPath } from './paths.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
const { chromium } = await import('playwright-core');
const child = spawn(process.execPath, [
  path.join(tools, 'node_modules/@playwright/mcp/cli.js'),
  '--headless', '--browser', 'chromium', '--isolated',
  '--executable-path', chromium.executablePath(),
  '--output-dir', path.join(tools, '.runtime', 'playwright'),
], { cwd: root, stdio: 'inherit', env: {
  ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserPath,
  LD_LIBRARY_PATH: [libraryPath, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
} });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
