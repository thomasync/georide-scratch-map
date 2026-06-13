import { test, expect } from '@playwright/test';

test.describe('Share mode', () => {
	test('shows an error for a corrupted share link', async ({ page }) => {
		await page.goto('/share?d=not-a-valid-payload');
		await expect(page.getByText(/Lien invalide/)).toBeVisible({ timeout: 15_000 });
	});

	test('generates a share link from demo and opens it', async ({ page, context }) => {
		await page.goto('/demo');
		await expect(page.getByText('TRAJETS')).toBeVisible({ timeout: 15_000 });

		await page.getByRole('button', { name: 'Partager' }).click();

		// Récupère l'URL générée depuis le champ de lien (input en lecture seule)
		const linkInput = page.locator('.share-url-input');
		await expect(linkInput).toBeVisible({ timeout: 10_000 });
		const shareUrl = await linkInput.inputValue();
		expect(shareUrl).toContain('/share?d=');

		// Ouvre le lien partagé dans une nouvelle page
		const shared = await context.newPage();
		const path = shareUrl.replace(/^https?:\/\/[^/]+/, '');
		await shared.goto(path);
		// Pas d'erreur "lien invalide" → le payload est décodé correctement
		await expect(shared.locator('#map')).toBeVisible({ timeout: 15_000 });
		await expect(shared.getByText(/Lien invalide/)).toHaveCount(0);
		await shared.close();
	});
});
