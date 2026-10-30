import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { root, tools } from './paths.mjs';

const config = JSON.parse(await readFile(new URL('../../opencode.json', import.meta.url), 'utf8'));
async function connect(name) {
  const entry = config.mcp.servers[name];
  const client = new Client({ name: 'practice05-smoke-check', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({
      command: entry.command[0], args: entry.command.slice(1), cwd: root,
      env: { ...process.env, ...entry.environment }, stderr: 'inherit',
    }), { timeout: 30000 });
    return client;
  } catch (error) { await client.close(); throw error; }
}
async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
  const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  if (result.isError || /rate limit exceeded|unauthorized|invalid api key/i.test(text)) {
    throw new Error(`${name}: ${text.slice(0, 1500)}`);
  }
  return text;
}

let failed = false;
const selected = process.argv.slice(2);
if (selected.some(name => name !== 'playwright')) throw new Error('Expected playwright.');
for (const name of selected.length ? selected : ['playwright']) {
  let client, http;
  try {
    client = await connect(name);
    // A disposable page held in memory; no application scaffold and no repository file server.
    http = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html lang="en"><title>MCP check</title><button onclick="document.querySelector(\'output\').textContent=\'browser works\'">Check</button><output>waiting</output></html>');
    });
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    await call(client, 'browser_navigate', { url: `http://127.0.0.1:${http.address().port}` });
    const result = await call(client, 'browser_evaluate', {
      function: "() => { document.querySelector('button').click(); return { title: document.title, value: document.querySelector('output').textContent }; }",
    });
    if (!result.includes('browser works') || !result.includes('MCP check')) throw new Error(`Browser check failed: ${result}`);
    const screenshot = path.join(tools, '.runtime', 'playwright', 'smoke.png');
    await mkdir(path.dirname(screenshot), { recursive: true });
    await call(client, 'browser_take_screenshot', { type: 'png', filename: screenshot });
    const bytes = await readFile(screenshot);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Screenshot is not a PNG.');
    await call(client, 'browser_close', {});
    console.log('OK: Playwright — Chromium открыл страницу, выполнил действие и сделал скриншот.');
  } catch (error) {
    failed = true;
    console.error(`FAIL: ${name}: ${error.message}`);
  } finally {
    await client?.close();
    if (http) await new Promise(resolve => http.close(resolve));
  }
}
process.exitCode = failed ? 1 : 0;
