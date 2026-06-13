import { test, expect } from '@playwright/test';
import { blockExternal } from './fixtures/api-mock';

test.describe('Summary modal', () => {
	test('opens the summary and navigates between tabs', async ({ page }) => {
		await blockExternal(page);
		await page.goto('/demo');

		await page.getByRole('button', { name: 'Récapitulatif' }).click();

		// Onglets visibles, "Bilan" par défaut avec ses cartes
		await expect(page.getByRole('button', { name: 'Bilan' })).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText('KM PARCOURUS')).toBeVisible();

		// Navigation vers Distances puis Essence — contenu non vide
		await page.getByRole('button', { name: 'Distances' }).click();
		await expect(page.getByText('KM PARCOURUS')).toHaveCount(0);

		await page.getByRole('button', { name: 'Essence' }).click();
		await expect(page.getByText('DÉPENSÉ AU TOTAL')).toBeVisible();
	});
});
