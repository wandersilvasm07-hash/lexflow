import { defineConfig, devices } from "@playwright/test";

/**
 * Testes end-to-end.
 *  - Sem Supabase configurado: testam páginas públicas, proteção de rotas e
 *    responsividade (corre em qualquer máquina/CI).
 *  - Com E2E_SUPABASE=1 e um projeto Supabase de testes: correm também os
 *    fluxos autenticados (tests/e2e/authenticated.spec.ts).
 */
const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "telemovel", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run start -- -p ${port}`,
    port,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
