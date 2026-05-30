export function extractCity(addr: string | null | undefined): string | null {
	if (!addr) return null;
	return (
		addr
			.split(',')
			.map((s) => s.trim())
			.find((s) => s.length > 0 && !/^\d/.test(s)) ?? null
	);
}
