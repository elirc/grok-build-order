import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] || 'backend';
if (!['backend', 'verify', 'database-check'].includes(mode)) throw new Error('Use backend, verify, or database-check.');
const binaryDirectory = process.env.POSTGRES_BIN || (process.platform === 'win32' ? 'C:\\Program Files\\PostgreSQL\\18\\bin' : '');
const binary = name => binaryDirectory ? join(binaryDirectory, name + (process.platform === 'win32' ? '.exe' : '')) : name;
const results = resolve(process.env.ORDER_VERIFY_RESULTS_DIR || join(root, '.verification'));
mkdirSync(results, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'astra-order-pg-'));
const cluster = join(temporary, 'cluster');
const ports = new Set();
async function freePort() {
  let port;
  do {
    port = await new Promise((resolvePort, reject) => {
      const probe = createServer(); probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => { const selected = probe.address().port; probe.close(() => resolvePort(selected)); });
    });
  } while (ports.has(port));
  ports.add(port); return port;
}
const port = await freePort();
const env = { ...process.env, DATABASE_URL: `postgresql://astra_test@127.0.0.1:${port}/astra_order_test?schema=public`, ORDER_TEST_DATABASE: 'owned-temporary-cluster', CI: '1' };
let startAttempted = false; let safeToRemove = true;
async function run(label, executable, args, cwd = root, timeout = 180_000) {
  console.log(`START ${label}`);
  try {
    const result = await execute(executable, args, { cwd, env, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 });
    writeFileSync(join(results, `${label}.log`), result.stdout + result.stderr);
    console.log(`PASS ${label}`); return result;
  } catch (error) {
    writeFileSync(join(results, `${label}.log`), String(error.stdout || '') + String(error.stderr || '') + '\n' + error.message);
    throw new Error(`${label} failed. See ${join(results, `${label}.log`)}`, { cause: error });
  }
}
const node = (label, relativeCli, args, cwd = root, timeout) => run(label, process.execPath, [join(root, relativeCli), ...args], cwd, timeout);
try {
  await run('initdb', binary('initdb'), ['-D', cluster, '--username=astra_test', '--auth=trust', '--encoding=UTF8', '--no-locale']);
  startAttempted = true; safeToRemove = false;
  await run('postgres-start', binary('pg_ctl'), ['-D', cluster, '-l', join(results, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  await run('createdb', binary('createdb'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'astra_test', 'astra_order_test']);
  await node('prisma-generate', 'backend/node_modules/prisma/build/index.js', ['generate'], join(root, 'backend'));
  await node('migrations', 'backend/node_modules/prisma/build/index.js', ['migrate', 'deploy'], join(root, 'backend'));
  if (mode !== 'database-check') {
    await node('backend-tests', 'backend/node_modules/jest/bin/jest.js', ['--runInBand', '--json', '--outputFile', join(results, 'backend.json')], join(root, 'backend'));
    const backend = JSON.parse(readFileSync(join(results, 'backend.json'), 'utf8'));
    if (!backend.success || !backend.numTotalTests || backend.numFailedTests || backend.numPendingTests) throw new Error('Backend tests did not all pass.');
    const summary = { passed: true, backendTests: backend.numPassedTests, database: 'PostgreSQL; fresh helper-owned loopback cluster; migrations applied', mode };
    if (mode === 'verify') {
      await node('backend-build', 'backend/node_modules/typescript/bin/tsc', [], join(root, 'backend'));
      await node('frontend-typecheck', 'frontend/node_modules/typescript/bin/tsc', [], join(root, 'frontend'));
      await node('frontend-tests', 'frontend/node_modules/vitest/vitest.mjs', ['run', '--maxWorkers=2', '--minWorkers=1', '--reporter=json', '--outputFile', join(results, 'frontend.json')], join(root, 'frontend'));
      const frontend = JSON.parse(readFileSync(join(results, 'frontend.json'), 'utf8'));
      if (!frontend.success || !frontend.numTotalTests || frontend.numFailedTests || frontend.numPendingTests) throw new Error('Frontend tests did not all pass.');
      await node('frontend-build', 'frontend/node_modules/vite/bin/vite.js', ['build'], join(root, 'frontend'));
      env.ORDER_API_PORT = String(await freePort()); env.ORDER_WEB_PORT = String(await freePort());
      const browser = await node('browser-tests', 'node_modules/playwright/cli.js', ['test', '--reporter=json'], root, 300_000);
      writeFileSync(join(results, 'browser.json'), browser.stdout);
      const stats = JSON.parse(browser.stdout).stats;
      if (!stats.expected || stats.unexpected || stats.flaky || stats.skipped) throw new Error('Browser tests did not all pass.');
      Object.assign(summary, { frontendTests: frontend.numPassedTests, browserTests: stats.expected, backendBuild: true, frontendBuild: true });
    }
    writeFileSync(join(results, 'results.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
  }
} finally {
  if (startAttempted) {
    try { await run('postgres-stop', binary('pg_ctl'), ['-D', cluster, '-m', 'fast', '-w', 'stop']); safeToRemove = true; }
    catch (error) { safeToRemove = false; console.error(`Shutdown was not confirmed; retained cluster directory: ${cluster}`); throw error; }
  }
  const inside = relative(resolve(tmpdir()), resolve(temporary));
  if (safeToRemove && inside && !inside.startsWith('..') && !isAbsolute(inside) && inside.startsWith('astra-order-pg-')) rmSync(temporary, { recursive: true, force: true });
}
