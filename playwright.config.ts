import { defineConfig } from '@playwright/test';
if (process.env.ORDER_TEST_DATABASE !== 'owned-temporary-cluster') throw new Error('Run npm run verify to create an isolated test database.');
const api = Number(process.env.ORDER_API_PORT); const web = Number(process.env.ORDER_WEB_PORT);
if (!api || !web) throw new Error('Verification ports must be allocated by the database helper.');
export default defineConfig({
  testDir: './e2e', workers: 1, retries: 0, timeout: 30000,
  use: { baseURL: `http://127.0.0.1:${web}`, browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node backend/dist/index.js', url: `http://127.0.0.1:${api}/health`, env: { PORT: String(api), HOST: '127.0.0.1' }, reuseExistingServer: false, timeout: 60000 },
    { command: `node frontend/node_modules/vite/bin/vite.js frontend --host 127.0.0.1 --port ${web} --strictPort`, url: `http://127.0.0.1:${web}`, env: { VITE_API_URL: `http://127.0.0.1:${api}/api` }, reuseExistingServer: false, timeout: 60000 }
  ]
});
