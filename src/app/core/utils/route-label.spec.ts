import { buildRouteLabel, dedupeCities } from './route-label';

describe('dedupeCities', () => {
	it('returns the intermediate cities when there are no duplicates', () => {
		expect(dedupeCities('Toulouse', ['Albi', 'Castres'], 'Carcassonne')).toEqual(['Albi', 'Castres']);
	});

	it('removes consecutive duplicates among the pauses', () => {
		expect(dedupeCities('Toulouse', ['Albi', 'Albi', 'Castres'], 'Carcassonne')).toEqual(['Albi', 'Castres']);
	});

	it('keeps non-consecutive duplicates', () => {
		// Seuls les doublons consécutifs sont supprimés : A,B,A,B reste intact
		expect(dedupeCities('Toulouse', ['Albi', 'Toulouse', 'Albi'], 'Carcassonne')).toEqual([
			'Albi',
			'Toulouse',
			'Albi',
		]);
	});

	it('drops a leading pause equal to the departure city', () => {
		expect(dedupeCities('Toulouse', ['Toulouse', 'Albi'], 'Carcassonne')).toEqual(['Albi']);
	});

	it('drops a trailing pause equal to the arrival city', () => {
		expect(dedupeCities('Toulouse', ['Albi', 'Carcassonne'], 'Carcassonne')).toEqual(['Albi']);
	});

	it('returns an empty array when there are no pauses', () => {
		expect(dedupeCities('Toulouse', [], 'Carcassonne')).toEqual([]);
	});

	it('returns an empty array for a loop without pauses', () => {
		expect(dedupeCities('Toulouse', [], 'Toulouse')).toEqual([]);
	});

	it('returns an empty array when every city is identical', () => {
		expect(dedupeCities('Toulouse', ['Toulouse', 'Toulouse'], 'Toulouse')).toEqual([]);
	});

	it('keeps the pauses of a loop with distinct stops', () => {
		expect(dedupeCities('Toulouse', ['Albi', 'Castres'], 'Toulouse')).toEqual(['Albi', 'Castres']);
	});
});

describe('buildRouteLabel', () => {
	describe('missing departure', () => {
		it('returns null when from is null', () => {
			expect(buildRouteLabel(null, 'Carcassonne', ['Albi'])).toBeNull();
		});

		it('returns null when from is undefined', () => {
			expect(buildRouteLabel(undefined, 'Carcassonne', [])).toBeNull();
		});

		it('returns null when from is an empty string', () => {
			expect(buildRouteLabel('', 'Carcassonne', [])).toBeNull();
		});
	});

	describe('simple A → B trip', () => {
		it('joins from and to with an arrow', () => {
			expect(buildRouteLabel('Toulouse', 'Carcassonne', [])).toBe('Toulouse → Carcassonne');
		});

		it('ignores pause labels when from and to differ', () => {
			// Les pauses ne sont affichées que pour les boucles
			expect(buildRouteLabel('Toulouse', 'Carcassonne', ['Albi', 'Castres'])).toBe('Toulouse → Carcassonne');
		});

		it('returns only from when to is null', () => {
			expect(buildRouteLabel('Toulouse', null, [])).toBe('Toulouse');
		});

		it('returns only from when to is undefined', () => {
			expect(buildRouteLabel('Toulouse', undefined, ['Albi'])).toBe('Toulouse');
		});

		it('returns only from when to is an empty string', () => {
			expect(buildRouteLabel('Toulouse', '', [])).toBe('Toulouse');
		});
	});

	describe('loop (from === to)', () => {
		it('returns null for a loop without pauses', () => {
			expect(buildRouteLabel('Toulouse', 'Toulouse', [])).toBeNull();
		});

		it('builds the full label for a loop with one pause', () => {
			expect(buildRouteLabel('Toulouse', 'Toulouse', ['Albi'])).toBe('Toulouse → Albi → Toulouse');
		});

		it('builds the full label for a loop with several pauses', () => {
			expect(buildRouteLabel('Toulouse', 'Toulouse', ['Albi', 'Castres'])).toBe(
				'Toulouse → Albi → Castres → Toulouse',
			);
		});

		it('removes consecutive duplicate pauses', () => {
			expect(buildRouteLabel('Toulouse', 'Toulouse', ['Albi', 'Albi', 'Castres', 'Castres'])).toBe(
				'Toulouse → Albi → Castres → Toulouse',
			);
		});

		it('removes pauses equal to the loop city at the edges', () => {
			expect(buildRouteLabel('Toulouse', 'Toulouse', ['Toulouse', 'Albi', 'Toulouse'])).toBe(
				'Toulouse → Albi → Toulouse',
			);
		});

		it('returns null when every pause equals the loop city', () => {
			expect(buildRouteLabel('Toulouse', 'Toulouse', ['Toulouse'])).toBeNull();
		});

		it('returns null when consecutive duplicate pauses all collapse into the loop city', () => {
			expect(buildRouteLabel('Toulouse', 'Toulouse', ['Toulouse', 'Toulouse'])).toBeNull();
		});

		it('keeps a non-consecutive occurrence of the loop city in the middle', () => {
			// Albi, Toulouse, Castres : le Toulouse central n'est pas consécutif, il reste
			expect(buildRouteLabel('Toulouse', 'Toulouse', ['Albi', 'Toulouse', 'Castres'])).toBe(
				'Toulouse → Albi → Toulouse → Castres → Toulouse',
			);
		});
	});
});
