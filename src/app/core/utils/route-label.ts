export function dedupeCities(from: string, pauseCities: string[], to: string): string[] {
	const parts = [from, ...pauseCities, to];
	const deduped = parts.filter((c, i) => i === 0 || c !== parts[i - 1]);
	return deduped.slice(1, -1);
}

export function buildRouteLabel(
	from: string | null | undefined,
	to: string | null | undefined,
	pauseLabels: string[],
): string | null {
	if (!from) return null;
	if (from !== to) return to ? `${from} → ${to}` : from;
	if (pauseLabels.length === 0) return null;
	const pauses = dedupeCities(from, pauseLabels, to);
	if (pauses.length === 0) return null;
	return [from, ...pauses, to].join(' → ');
}
