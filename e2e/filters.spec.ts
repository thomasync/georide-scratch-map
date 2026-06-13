import { test, expect } from '@playwright/test';
import { blockExternal } from './fixtures/api-mock';

test.describe('Date filters', () => {
	test('applies and resets a period filter', async ({ page }) => {
		await blockExternal(page);
		await page.goto('/demo');

		await expect(page.getByText('TRAJETS')).toBeVisible({ timeout: 15_000 });
		const tousChip = page.getByRole('button', { name: 'Tout', exact: true });
		await expect(tousChip).toBeVisible();

		// Applique un filtre restrictif puis revient à "Tout"
		await page.getByRole('button', { name: 'Cette année', exact: true }).click();
		await expect(page.getByText('TRAJETS')).toBeVisible();

		await tousChip.click();
		await expect(page.getByText('TRAJETS')).toBeVisible();
	});
});
