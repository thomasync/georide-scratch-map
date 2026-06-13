import { test, expect } from '@playwright/test';

test.describe('Date filters', () => {
	test('applies and resets a period filter', async ({ page }) => {
		await page.goto('/demo');

		// La barre de filtres apparaît après le chargement des données démo
		const tousChip = page.getByRole('button', { name: 'Tout', exact: true });
		await expect(tousChip).toBeVisible({ timeout: 20_000 });

		// Applique un filtre restrictif puis revient à "Tout"
		await page.getByRole('button', { name: 'Cette année', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Cette année', exact: true })).toBeVisible();

		await tousChip.click();
		await expect(tousChip).toBeVisible();
	});
});
