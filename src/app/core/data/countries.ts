export interface Country {
	code: string;
	name: string;
	flag: string;
	minLat?: number;
	maxLat?: number;
	minLon?: number;
	maxLon?: number;
}

export const COUNTRIES: Country[] = [
	{ code: 'FR', name: 'France', flag: '🇫🇷', minLat: 41.3, maxLat: 51.2, minLon: -5.2, maxLon: 9.6 },
	{ code: 'ES', name: 'Espagne', flag: '🇪🇸', minLat: 35.9, maxLat: 43.8, minLon: -9.3, maxLon: 4.4 },
	{ code: 'AD', name: 'Andorre', flag: '🇦🇩', minLat: 42.42, maxLat: 42.66, minLon: 1.4, maxLon: 1.8 },
	{ code: 'PT', name: 'Portugal', flag: '🇵🇹', minLat: 36.8, maxLat: 42.2, minLon: -9.5, maxLon: -6.2 },
	{ code: 'BE', name: 'Belgique', flag: '🇧🇪', minLat: 49.5, maxLat: 51.5, minLon: 2.5, maxLon: 6.4 },
	{ code: 'NL', name: 'Pays-Bas', flag: '🇳🇱', minLat: 50.7, maxLat: 53.6, minLon: 3.3, maxLon: 7.2 },
	{ code: 'LU', name: 'Luxembourg', flag: '🇱🇺', minLat: 49.4, maxLat: 50.2, minLon: 5.7, maxLon: 6.5 },
	{ code: 'DE', name: 'Allemagne', flag: '🇩🇪', minLat: 47.3, maxLat: 55.1, minLon: 6.0, maxLon: 15.0 },
	{ code: 'CH', name: 'Suisse', flag: '🇨🇭', minLat: 45.8, maxLat: 47.8, minLon: 6.0, maxLon: 10.5 },
	{ code: 'LI', name: 'Liechtenstein', flag: '🇱🇮', minLat: 47.05, maxLat: 47.27, minLon: 9.47, maxLon: 9.64 },
	{ code: 'AT', name: 'Autriche', flag: '🇦🇹', minLat: 46.4, maxLat: 49.0, minLon: 9.5, maxLon: 17.2 },
	{ code: 'IT', name: 'Italie', flag: '🇮🇹', minLat: 36.6, maxLat: 47.1, minLon: 7.6, maxLon: 18.5 },
	{ code: 'MC', name: 'Monaco', flag: '🇲🇨', minLat: 43.72, maxLat: 43.78, minLon: 7.37, maxLon: 7.44 },
	{ code: 'SI', name: 'Slovénie', flag: '🇸🇮', minLat: 45.4, maxLat: 46.9, minLon: 13.4, maxLon: 16.6 },
	{ code: 'MA', name: 'Maroc', flag: '🇲🇦', minLat: 27.7, maxLat: 35.9, minLon: -13.2, maxLon: -1.0 },
	{ code: 'GB', name: 'Angleterre', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', minLat: 49.9, maxLat: 55.8, minLon: -5.7, maxLon: 1.8 },
	{ code: 'IE', name: 'Irlande', flag: '🇮🇪', minLat: 51.4, maxLat: 55.4, minLon: -10.5, maxLon: -5.9 },
	{ code: 'IM', name: 'Île de Man', flag: '🇮🇲', minLat: 54.0, maxLat: 54.5, minLon: -4.85, maxLon: -4.3 },
	{ code: 'SCO', name: 'Écosse', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', minLat: 54.6, maxLat: 60.9, minLon: -7.6, maxLon: -0.7 },
	{ code: 'WAL', name: 'Pays de Galles', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', minLat: 51.3, maxLat: 53.5, minLon: -5.3, maxLon: -2.6 },
	{ code: 'HR', name: 'Croatie', flag: '🇭🇷', minLat: 42.4, maxLat: 46.6, minLon: 13.5, maxLon: 19.5 },
	{ code: 'DK', name: 'Danemark', flag: '🇩🇰', minLat: 54.5, maxLat: 57.8, minLon: 8.0, maxLon: 15.2 },
	{ code: 'SE', name: 'Suède', flag: '🇸🇪', minLat: 55.3, maxLat: 69.1, minLon: 10.9, maxLon: 24.2 },
	{ code: 'NO', name: 'Norvège', flag: '🇳🇴', minLat: 57.9, maxLat: 71.2, minLon: 4.5, maxLon: 31.1 },
	{ code: 'CZ', name: 'République tchèque', flag: '🇨🇿', minLat: 48.5, maxLat: 51.1, minLon: 12.1, maxLon: 18.9 },
	{ code: 'HU', name: 'Hongrie', flag: '🇭🇺', minLat: 45.7, maxLat: 48.6, minLon: 16.1, maxLon: 22.9 },
	{ code: 'RO', name: 'Roumanie', flag: '🇷🇴', minLat: 43.6, maxLat: 48.3, minLon: 20.3, maxLon: 29.7 },
	{ code: 'GR', name: 'Grèce', flag: '🇬🇷', minLat: 34.8, maxLat: 41.8, minLon: 19.5, maxLon: 28.3 },
	{ code: 'TN', name: 'Tunisie', flag: '🇹🇳', minLat: 30.2, maxLat: 37.5, minLon: 7.5, maxLon: 11.6 },
	{ code: 'IS', name: 'Islande', flag: '🇮🇸', minLat: 63.3, maxLat: 66.6, minLon: -24.5, maxLon: -13.5 },
];

export type NeighboringCountry = Country & Required<Pick<Country, 'minLat' | 'maxLat' | 'minLon' | 'maxLon'>>;

export const NEIGHBORING_COUNTRIES: NeighboringCountry[] = COUNTRIES.filter(
	(c): c is NeighboringCountry => c.code !== 'FR' && c.minLat !== undefined,
);

export function countryFlag(code: string): string {
	return COUNTRIES.find((c) => c.code === code)?.flag ?? '';
}
