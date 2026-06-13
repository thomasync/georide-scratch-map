import { test, expect } from '@playwright/test';

test.describe('Summary modal', () => {
	test('opens the summary and navigates between tabs', async ({ page }) => {
		await page.goto('/demo');

		await page.getByRole('button', { name: 'Récapitulatif' }).click();

		// Onglets visibles, "Bilan" par défaut avec ses cartes (texte DOM en minuscules, capitalisé par CSS)
		await expect(page.getByRole('button', { name: 'Bilan' })).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText('km parcourus')).toBeVisible();

		// Navigation vers Essence → le sélecteur de carburant (SP98/SP95/E10) est rendu dès que l'onglet est actif.
		// toPass re-clique tant que la bascule d'onglet (animée) n'a pas pris.
		await expect(async () => {
			await page.getByRole('button', { name: 'Essence' }).click();
			await expect(page.getByRole('button', { name: 'SP98', exact: true })).toBeVisible({ timeout: 3000 });
		}).toPass({ timeout: 20_000 });
	});
});
