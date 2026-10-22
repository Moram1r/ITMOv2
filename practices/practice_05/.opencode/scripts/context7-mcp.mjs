// The official Context7 server, reached over stdio when WSL cannot reach its HTTPS endpoint.
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const endpoint = 'https://mcp.context7.com/mcp';

async function windowsFetch(url, options = {}) {
  if (String(url) !== endpoint) throw new Error('Context7 transport only supports its official endpoint.');
  const args = ['--silent', '--show-error', '--include', '--connect-timeout', '8', '--max-time', '55',
    '--proxy', process.env.CONTEXT7_WINDOWS_PROXY, '--request', options.method ?? 'GET'];
  for (const [key, value] of new Headers(options.headers)) args.push('--header', `${key}: ${value}`);
  if (options.body != null) args.push('--data-binary', '@-');
  args.push(endpoint);
  const raw = await new Promise((resolve, reject) => {
    const child = spawn('/mnt/c/Windows/System32/curl.exe', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0, error = '';
    const abort = () => child.kill('SIGTERM');
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) { child.kill(); reject(new Error('Context7 response exceeds 8 MiB.')); }
      else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => { error += chunk; });
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', code => {
      options.signal?.removeEventListener('abort', abort);
      if (code !== 0) reject(new Error(`Context7 Windows transport: ${error.trim() || `exit ${code}`}`));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.end(options.body ?? undefined);
  });
  let remaining = raw, status, headers;
  // curl includes both the proxy CONNECT response and the origin's headers.
  while (remaining.startsWith('HTTP/')) {
    const boundary = /\r?\n\r?\n/.exec(remaining);
    if (!boundary) throw new Error('Incomplete Context7 HTTP response.');
    const lines = remaining.slice(0, boundary.index).split(/\r?\n/);
    status = Number(lines.shift().split(' ')[1]);
    headers = new Headers();
    for (const line of lines) {
      const colon = line.indexOf(':');
      if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
    }
    remaining = remaining.slice(boundary.index + boundary[0].length);
  }
  if (!status) throw new Error('Context7 did not return HTTP headers.');
  headers.delete('transfer-encoding');
  headers.delete('content-length');
  return new Response([204, 205, 304].includes(status) ? null : remaining, { status, headers });
}

const upstream = new Client({ name: 'practice05-context7-transport', version: '1.0.0' });
let server;
try {
  await upstream.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    ...(process.env.CONTEXT7_WINDOWS_PROXY ? { fetch: windowsFetch } : {}),
  }), { timeout: 25000 });
  server = new Server(upstream.getServerVersion(), {
    capabilities: { tools: {} }, instructions: upstream.getInstructions(),
  });
  server.setRequestHandler(ListToolsRequestSchema, () => upstream.listTools());
  server.setRequestHandler(CallToolRequestSchema, request => upstream.callTool(request.params, undefined, { timeout: 60000 }));
  const shutdown = async () => { await server.close(); await upstream.close(); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdown().finally(() => process.exit()); });
  process.stdin.on('end', () => { void shutdown(); });
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(error.message);
  await upstream.close();
  process.exitCode = 1;
}
