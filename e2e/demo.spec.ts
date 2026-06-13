import { test, expect } from '@playwright/test';

// Bruit attendu (tuiles/élévation externes, WebGL en headless) — on ne fait échouer que sur de vraies erreurs JS applicatives.
const IGNORED_ERROR = /Failed to load resource|net::|MapLibre|WebGL|tile/i;

test.describe('Demo mode', () => {
	test('loads trips and shows the summary controls without app errors', async ({ page }) => {
		const errors: string[] = [];
		page.on(
			'console',
			(msg) => msg.type() === 'error' && !IGNORED_ERROR.test(msg.text()) && errors.push(msg.text()),
		);

		await page.goto('/demo');

		// Conteneur de carte présent + watermark démo
		await expect(page.locator('#map')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText('DEMO', { exact: true })).toBeVisible();

		// Compteurs alimentés par les données démo
		await expect(page.getByText('TRAJETS')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByRole('button', { name: 'Récapitulatif' })).toBeVisible();

		expect(errors, `app console errors: ${errors.join('\n')}`).toEqual([]);
	});

	test('does not require authentication', async ({ page }) => {
		await page.goto('/demo');
		await expect(page).toHaveURL(/\/demo$/);
		await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
	});
});
