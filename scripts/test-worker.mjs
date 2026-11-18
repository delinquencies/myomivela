import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
const files = readdirSync(new URL('../tests/', import.meta.url))
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => fileURLToPath(new URL('../tests/' + name, import.meta.url)));
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  env: { ...process.env, MYO_TARGET: 'worker' },
  stdio: 'inherit',
  windowsHide: true,
});
child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
