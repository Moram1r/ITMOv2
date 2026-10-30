import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { root, tools } from '../scripts/paths.mjs';

const run = promisify(execFile);
export default {
  id: 'practice05-quality-gate',
  async setup(context) {
    const registration = await context.tool.hook('execute.after', async event => {
      if (event.status !== 'completed') return;
      if (!['write', 'edit', 'patch', 'apply_patch'].includes(event.tool.split('.').at(-1))) return;
      let report;
      try {
        const result = await run('node', [path.join(tools, 'scripts/check.mjs'), '--fast'], {
          cwd: root, timeout: 15000, maxBuffer: 32000,
        });
        report = result.stdout.trim();
      } catch (error) {
        report = `FAIL: ${(error.stdout || '') + (error.stderr || '') || error.message}`;
      }
      event.result.content.push({ type: 'text', text: `\n[practice_05: автоматическая проверка]\n${report}` });
    });
    return () => registration.dispose();
  },
};
