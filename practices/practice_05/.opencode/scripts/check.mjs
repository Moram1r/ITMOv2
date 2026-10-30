import { readFile, readdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, tools } from './paths.mjs';

const fast = process.argv.includes('--fast');
try {
  for (const file of ['opencode.json', '.opencode/package.json']) {
    JSON.parse(await readFile(path.join(root, file), 'utf8'));
  }
  for (const folder of ['scripts', 'plugins']) {
    for (const file of await readdir(path.join(tools, folder))) {
      if (!/\.[cm]?js$/.test(file)) continue;
      const result = spawnSync(process.execPath, ['--check', path.join(tools, folder, file)], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed: ${file}`);
    }
  }
  for (const name of ['frontend-design', 'test-driven-development', 'systematic-debugging']) {
    const body = await readFile(path.join(tools, 'skills', name, 'SKILL.md'), 'utf8');
    if (!body.startsWith(`---\nname: ${name}\ndescription: `)) throw new Error(`Invalid skill: ${name}`);
  }
  await access(path.join(tools, 'node_modules/@playwright/mcp/cli.js'));
  console.log('OK: конфигурация, навыки, синтаксис скриптов и зависимости окружения.');
  if (!fast) {
    const manifest = path.join(root, 'project', 'package.json');
    let app;
    try { app = JSON.parse(await readFile(manifest, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!app) console.log('SKIP: приложение ещё не создано; его тесты и сборка не запускались.');
    else {
      if (!app.scripts?.check) throw new Error('Добавь npm run check в project/package.json.');
      const result = spawnSync('npm', ['run', 'check'], { cwd: path.dirname(manifest), stdio: 'inherit', timeout: 180000 });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Проверка приложения завершилась с кодом ${result.status}.`);
    }
  }
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
