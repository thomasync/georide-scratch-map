import { TestBed } from '@angular/core/testing';
import { PolylineService } from './polyline';
import { provideSilentLogger } from '../../../test/helpers/providers';

// Polyline de référence de la documentation Google (3 points connus)
const REFERENCE_ENCODED = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const REFERENCE_DECODED: [number, number][] = [
	[38.5, -120.2],
	[40.7, -120.95],
	[43.252, -126.453],
];

describe('PolylineService', () => {
	let service: PolylineService;

	beforeEach(() => {
		TestBed.configureTestingModule({ providers: [provideSilentLogger()] });
		service = TestBed.inject(PolylineService);
	});

	it('should be created', () => {
		expect(service).toBeTruthy();
	});

	describe('decode', () => {
		it('decodes the reference Google polyline into the known coordinates', () => {
			expect(service.decode(REFERENCE_ENCODED)).toEqual(REFERENCE_DECODED);
		});

		it('returns an empty array for an empty string', () => {
			expect(service.decode('')).toEqual([]);
		});

		it('decodes a single point', () => {
			expect(service.decode('_p~iF~ps|U')).toEqual([[38.5, -120.2]]);
		});

		it('decodes a zero coordinate', () => {
			// '?' (charCode 63) encode un delta de 0
			expect(service.decode('??')).toEqual([[0, 0]]);
		});

		it('accumulates deltas across consecutive points', () => {
			// 'A' encode un delta de +1 (1e-5) — la longitude se cumule de point en point
			expect(service.decode('?A?A')).toEqual([
				[0, 0.00001],
				[0, 0.00002],
			]);
		});

		it('decodes a negative delta', () => {
			// '@' (charCode 64) encode un delta de -1 (1e-5)
			expect(service.decode('?@')).toEqual([[0, -0.00001]]);
		});

		it('tolerates a truncated string missing the longitude chunk', () => {
			// Comportement réel : la longitude absente est décodée comme 0, sans exception
			expect(service.decode('_p~iF')).toEqual([[38.5, 0]]);
		});
	});

	describe('extractFromStaticImage', () => {
		it('extracts and decodes the polyline from a static image URL with a path parameter', () => {
			const url = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/path-2+f00-0.7(${encodeURIComponent(
				REFERENCE_ENCODED,
			)})/auto/600x400`;

			expect(service.extractFromStaticImage(url)).toEqual(REFERENCE_DECODED);
		});

		it('decodes percent-encoded characters in the path before decoding the polyline', () => {
			// Le caractère '|' est encodé %7C dans l'URL — decodeURIComponent doit s'appliquer avant le décodage
			const url = 'https://example.com/static/path-5+0000ff(_p~iF~ps%7CU)/auto/500x300';
			expect(service.extractFromStaticImage(url)).toEqual([[38.5, -120.2]]);
		});

		it('uses the first path parameter when several are present', () => {
			const url = 'https://example.com/static/path-2+f00(??),path-2+0f0(_p~iF~ps|U)/auto';
			expect(service.extractFromStaticImage(url)).toEqual([[0, 0]]);
		});

		it('returns an empty array when the URL has no path parameter', () => {
			expect(service.extractFromStaticImage('https://maps.example.com/static.png')).toEqual([]);
		});

		it('returns an empty array for an empty string', () => {
			expect(service.extractFromStaticImage('')).toEqual([]);
		});

		it('returns an empty array for a string that is not a URL', () => {
			expect(service.extractFromStaticImage('not a url at all')).toEqual([]);
		});

		it('returns an empty array when the path parentheses are empty', () => {
			// La regex exige au moins un caractère entre les parenthèses
			expect(service.extractFromStaticImage('https://example.com/static/path-2+f00()/auto/600x400')).toEqual([]);
		});

		it('returns an empty array when the path parenthesis is never closed', () => {
			expect(service.extractFromStaticImage('https://example.com/static/path-2+f00(_p~iF~ps|U/auto')).toEqual([]);
		});

		it('returns an empty array when there is no style segment between "path-" and the parenthesis', () => {
			// La regex exige au moins un caractère de style entre 'path-' et '('
			expect(service.extractFromStaticImage('https://example.com/static/path-(_p~iF~ps|U)/auto')).toEqual([]);
		});

		it('propagates a URIError when the path contains invalid percent-encoding', () => {
			// Comportement réel : decodeURIComponent n'est pas protégé par un try/catch
			expect(() => service.extractFromStaticImage('https://example.com/static/path-2+f00(%E0%A4)/auto')).toThrow(
				URIError,
			);
		});
	});
});
