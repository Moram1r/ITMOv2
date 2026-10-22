import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './paths.mjs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// An empty temporary session initializes plugins. No prompt or model request is sent.
const onPath = (process.env.PATH ?? '').split(path.delimiter).map(dir => path.join(dir, 'opencode')).find(existsSync);
const binary = process.env.OPENCODE_BIN || onPath || path.join(homedir(), '.opencode/bin/opencode');
const child = spawn(binary, [
  'serve', '--hostname', '127.0.0.1', '--port', '0',
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', startupError, sessionID, base, auth;
child.on('error', error => { startupError = error; });
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
async function api(method, route, data) {
  const response = await fetch(base + route, {
    method, headers: { Authorization: auth, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}
try {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    base = output.match(/server listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    const password = output.match(/server password (\S+)/)?.[1];
    if (base && password) { auth = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`; break; }
    if (child.exitCode !== null) throw new Error('OpenCode diagnostic server exited before startup.');
    await delay(100);
  }
  if (!auth) throw new Error('OpenCode diagnostic server did not start in 15 seconds.');
  const created = await api('POST', '/api/session', { title: 'practice05 environment diagnostic (no model)' });
  sessionID = created.data.id;
  let ready = false;
  const registrationDeadline = Date.now() + 40000;
  while (Date.now() < registrationDeadline) {
    const plugins = (await api('GET', '/api/plugin')).data;
    const skills = (await api('GET', '/api/skill')).data;
    const mcp = (await api('GET', '/api/mcp')).data;
    const hook = plugins.find(plugin => plugin.id === 'practice05-quality-gate');
    if (hook?.state.status === 'failed') throw new Error(hook.state.error);
    const names = ['frontend-design', 'test-driven-development', 'systematic-debugging'];
    const servers = ['context7', 'playwright'];
    for (const server of mcp.filter(server => servers.includes(server.name))) {
      if (server.status.status === 'failed') throw new Error(`${server.name}: ${server.status.error}`);
    }
    ready = hook?.state.status === 'active'
      && names.every(name => skills.some(skill => skill.id === name && skill.description))
      && servers.every(name => mcp.some(server => server.name === name && server.status.status === 'connected'))
      && mcp.find(server => server.name === 'text-stats')?.status.status === 'disabled';
    if (ready) break;
    await delay(300);
  }
  if (!ready) throw new Error('OpenCode did not register the skills, hook and MCP servers within 40 seconds.');
  const sources = await api('GET', '/api/config');
  const inherited = sources.some(source => source.type === 'document' && source.path !== `${root}opencode.json`
    && Object.keys(source.info.providers ?? {}).length);
  if (!inherited) throw new Error('No inherited provider configuration found.');
  const commands = (await api('GET', '/api/command')).data;
  if (!['check', 'env-check'].every(name => commands.some(command => command.name === name))) {
    throw new Error('Local commands were not registered.');
  }
  console.log('OK: OpenCode обнаружил 3 навыка, активный хук, /check и /env-check.');
  console.log('OK: Context7 и Playwright подключены; text-stats отключён в этой практике.');
  console.log('OK: настройки провайдера унаследованы; запросов к модели не было.');
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (sessionID) await api('DELETE', `/api/session/${sessionID}`).catch(() => {});
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
