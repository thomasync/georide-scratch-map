import { defineConfig, devices } from '@playwright/test';

/**
 * Tests e2e — lancent l'app via `npm start` (ng serve sur :4200).
 * Premier run lent (compilation). Voir e2e/AI-CHECKLIST.md pour les scénarios exploratoires manuels.
 */
export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'list',
	use: {
		baseURL: 'http://localhost:4200',
		trace: 'on-first-retry',
		viewport: { width: 1280, height: 800 },
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'npm start',
		url: 'http://localhost:4200',
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
	},
});
