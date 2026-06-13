import { extractCity } from './address';

describe('extractCity', () => {
	describe('empty inputs', () => {
		it('should return null for null', () => {
			expect(extractCity(null)).toBeNull();
		});

		it('should return null for undefined', () => {
			expect(extractCity(undefined)).toBeNull();
		});

		it('should return null for an empty string', () => {
			expect(extractCity('')).toBeNull();
		});

		it('should return null for a whitespace-only string', () => {
			expect(extractCity('   ')).toBeNull();
		});

		it('should return null for a string made only of commas and spaces', () => {
			expect(extractCity(', , ,')).toBeNull();
		});
	});

	describe('simple addresses', () => {
		it('should return the address itself when there is no comma', () => {
			expect(extractCity('Toulouse')).toBe('Toulouse');
		});

		it('should trim surrounding whitespace on a single segment', () => {
			expect(extractCity('  Toulouse  ')).toBe('Toulouse');
		});

		it('should keep a multi-word city name intact', () => {
			expect(extractCity('Saint-Jean de Luz')).toBe('Saint-Jean de Luz');
		});
	});

	describe('CSV multi-segment addresses', () => {
		it('should return the first segment of a comma-separated list', () => {
			expect(extractCity('Toulouse, Occitanie, France')).toBe('Toulouse');
		});

		it('should trim spaces around each segment', () => {
			expect(extractCity('  Lyon ,  Rhône , France ')).toBe('Lyon');
		});

		it('should skip empty segments and return the first non-empty one', () => {
			expect(extractCity(', ,Bordeaux, France')).toBe('Bordeaux');
		});
	});

	describe('numeric segments (postal codes)', () => {
		it('should skip a leading postal code segment', () => {
			expect(extractCity('31000, Toulouse, France')).toBe('Toulouse');
		});

		it('should skip every segment starting with a digit', () => {
			expect(extractCity('12 Rue de la Paix, 75001, Paris')).toBe('Paris');
		});

		it('should skip a segment starting with a digit even if it contains letters', () => {
			expect(extractCity('31000 Toulouse, France')).toBe('France');
		});

		it('should return null when all segments start with a digit', () => {
			expect(extractCity('31000, 31100')).toBeNull();
		});

		it('should not skip a segment containing digits but not starting with one', () => {
			expect(extractCity('Toulouse 31000, France')).toBe('Toulouse 31000');
		});

		it('should skip a segment whose first character after trim is a digit', () => {
			expect(extractCity('  31000 , Toulouse')).toBe('Toulouse');
		});
	});
});
