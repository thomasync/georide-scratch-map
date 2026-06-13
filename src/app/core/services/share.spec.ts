import { TestBed } from '@angular/core/testing';
import { latLngToCell } from 'h3-js';
import {
	NeighboringCountryBounds,
	ShareData,
	ShareHexPayload,
	SharePolylinePayload,
	ShareService,
	ShareStats,
} from './share';
import { makeDepartments } from '../../../test/fixtures/geojson';
import { makeTripWithCoords, resetTripSeq } from '../../../test/fixtures/trips';

describe('ShareService', () => {
	let service: ShareService;

	beforeEach(() => {
		resetTripSeq();
		TestBed.configureTestingModule({});
		service = TestBed.inject(ShareService);
	});

	// Construit un payload polyline réaliste à partir de la fixture trip
	function makePolylinePayload(): SharePolylinePayload {
		const trip = makeTripWithCoords();
		return {
			coords: trip.coords,
			dist: trip.distance,
			dur: trip.duration,
			title: trip.endAddress,
			startAddr: trip.startAddress,
			startTime: trip.startTime,
			endTime: trip.endTime,
			avgSpd: trip.averageSpeed,
			maxSpd: trip.maxSpeed,
			maxAngle: trip.maxAngle ?? undefined,
			maxLeftAngle: trip.maxLeftAngle,
			maxRightAngle: trip.maxRightAngle,
		};
	}

	describe('encode / decode roundtrip', () => {
		it('roundtrips a dept payload with stats and ts', async () => {
			const data: ShareData = {
				v: 1,
				mode: 'dept',
				dept: {
					depts: [
						['01', 42, 'FR'],
						['02', 100, 'FR'],
						['BE-1', 7, 'BE'],
					],
				},
				stats: { t: 12, k: 3456, c: 2, ci: 48, r: 9, fn: 'Éléonore' },
				ts: 1_770_000_000_000,
			};

			const encoded = await service.encode(data);
			const decoded = await service.decode(encoded);

			expect(decoded).toEqual(data);
		});

		it('roundtrips a dept payload without optional stats', async () => {
			const data: ShareData = { v: 1, mode: 'dept', dept: { depts: [['31', 80, 'FR']] } };

			const decoded = await service.decode(await service.encode(data));

			expect(decoded).toEqual(data);
			expect(decoded.stats).toBeUndefined();
			expect(decoded.ts).toBeUndefined();
		});

		it('roundtrips a hex payload with counts and compact flag', async () => {
			const cells = [latLngToCell(43.6045, 1.4442, 7), latLngToCell(43.2128, 2.3508, 7)];
			const data: ShareData = {
				v: 1,
				mode: 'hex',
				hex: { res: 7, cells, compact: true, counts: [2, 3] },
				stats: { t: 1, k: 90 },
			};

			const decoded = await service.decode(await service.encode(data));

			expect(decoded).toEqual(data);
		});

		it('roundtrips a polyline payload with computed stats and embedded hex', async () => {
			const hex: ShareHexPayload = { res: 6, cells: [latLngToCell(43.6, 1.44, 6)] };
			const data: ShareData = {
				v: 1,
				mode: 'polyline',
				poly: {
					...makePolylinePayload(),
					computed: {
						altMin: 120,
						altMax: 850,
						elevGain: 1450,
						pctInTurn: 23.5,
						avgSpeedInTurns: 52,
						maxSpeedInTurns: 88,
						maxAngleDelta: 45,
						pauseCount: 2,
						pauseTotalMin: 35,
						pauseCities: ['Castelnaudary', 'Bram'],
					},
					routeLabel: 'Toulouse → Carcassonne',
					hex,
				},
				stats: { t: 1, k: 90, fn: 'Éléonore' },
				ts: 1_770_000_000_123,
			};

			const decoded = await service.decode(await service.encode(data));

			expect(decoded).toEqual(data);
		});

		it('roundtrips a minimal polyline payload (coords only)', async () => {
			const data: ShareData = {
				v: 1,
				mode: 'polyline',
				poly: { coords: makeTripWithCoords().coords },
			};

			const decoded = await service.decode(await service.encode(data));

			expect(decoded).toEqual(data);
		});

		it('produces a base64url string without +, / or padding', async () => {
			const data: ShareData = {
				v: 1,
				mode: 'dept',
				dept: { depts: Array.from({ length: 60 }, (_, i): [string, number, string] => [`${i}`, i + 1, 'FR']) },
				stats: { t: 999, k: 123456, fn: 'Aéroport → Côte d’Azur' },
			};

			const encoded = await service.encode(data);

			expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
		});
	});

	describe('encodedLength', () => {
		it('returns the length of the encoded string', async () => {
			const data: ShareData = {
				v: 1,
				mode: 'hex',
				hex: { res: 6, cells: [latLngToCell(43.6, 1.44, 6), latLngToCell(43.7, 1.5, 6)] },
			};

			const encoded = await service.encode(data);
			const length = await service.encodedLength(data);

			expect(length).toBe(encoded.length);
			expect(length).toBeGreaterThan(0);
		});
	});

	describe('decode with corrupted input', () => {
		// Le source n'attend jamais writer.write()/writer.close() : sur un flux deflate invalide,
		// ces promesses ignorées rejettent et provoquent des unhandledRejection qui font échouer
		// le run vitest. On marque ces promesses comme gérées sans changer le comportement.
		interface WriterLike {
			write(chunk?: unknown): Promise<void>;
			close(): Promise<void>;
		}

		beforeEach(() => {
			const proto = Object.getPrototypeOf(
				new DecompressionStream('deflate-raw').writable.getWriter(),
			) as WriterLike;
			const origWrite = proto.write;
			const origClose = proto.close;
			vi.spyOn(proto, 'write').mockImplementation(function (this: WriterLike, chunk?: unknown) {
				const p = origWrite.call(this, chunk);
				p.catch(() => {});
				return p;
			});
			vi.spyOn(proto, 'close').mockImplementation(function (this: WriterLike) {
				const p = origClose.call(this);
				p.catch(() => {});
				return p;
			});
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it('rejects when the string contains invalid base64 characters', async () => {
			await expect(service.decode('@@@@invalid!!')).rejects.toThrow();
		});

		it('rejects when the bytes are not a valid deflate-raw stream', async () => {
			// 'AAAAAAAA' = octets nuls → bloc deflate "stored" avec NLEN invalide
			await expect(service.decode('AAAAAAAA')).rejects.toThrow();
		});

		it('rejects when a valid encoded string is truncated', async () => {
			const data: ShareData = { v: 1, mode: 'dept', dept: { depts: [['31', 80, 'FR']] } };
			const encoded = await service.encode(data);

			await expect(service.decode(encoded.slice(0, Math.floor(encoded.length / 2)))).rejects.toThrow();
		});
	});

	describe('buildDeptPayload', () => {
		it('keeps only features with pct > 0 and rounds the percentage', () => {
			const fc = makeDepartments();
			fc.features[0].properties = { ...fc.features[0].properties, pct: 42.6 };
			fc.features[1].properties = { ...fc.features[1].properties, pct: 0 };

			const payload = service.buildDeptPayload(fc);

			expect(payload.depts).toEqual([['01', 43, 'FR']]);
		});

		it('excludes features with negative or missing pct', () => {
			const fc = makeDepartments();
			fc.features[0].properties = { ...fc.features[0].properties, pct: -5 };
			// features[1] n'a pas de pct → traité comme 0

			const payload = service.buildDeptPayload(fc);

			expect(payload.depts).toEqual([]);
		});

		it('defaults code to empty string and country to FR when missing', () => {
			const fc = makeDepartments();
			fc.features = [fc.features[0]];
			fc.features[0].properties = { pct: 10.2 };

			const payload = service.buildDeptPayload(fc);

			expect(payload.depts).toEqual([['', 10, 'FR']]);
		});

		it('preserves a non-FR country code', () => {
			const fc = makeDepartments();
			fc.features = [fc.features[0]];
			fc.features[0].properties = { code: 'BE-WLG', country: 'BE', pct: 99.5 };

			const payload = service.buildDeptPayload(fc);

			expect(payload.depts).toEqual([['BE-WLG', 100, 'BE']]);
		});

		it('handles features with null properties without crashing', () => {
			const fc = makeDepartments();
			fc.features[0].properties = null;
			fc.features[1].properties = { ...fc.features[1].properties, pct: 50 };

			const payload = service.buildDeptPayload(fc);

			expect(payload.depts).toEqual([['02', 50, 'FR']]);
		});

		it('returns an empty list for an empty FeatureCollection', () => {
			const fc = makeDepartments();
			fc.features = [];

			expect(service.buildDeptPayload(fc)).toEqual({ depts: [] });
		});
	});

	describe('buildHexPayload', () => {
		const cellA = latLngToCell(43.6, 1.44, 6);
		const cellB = latLngToCell(43.7, 1.55, 6);
		const cellC = latLngToCell(43.8, 1.66, 6);

		it('omits counts when every count is 1', () => {
			const payload = service.buildHexPayload({ [cellA]: 1, [cellB]: 1 }, 6);

			expect(payload).toEqual({ res: 6, cells: [cellA, cellB] });
			expect(payload.counts).toBeUndefined();
		});

		it('omits counts when values clamp down to 1 (0 or negative)', () => {
			// 0 et -2 sont remontés à 1 par le clamp → tout vaut 1 → counts omis
			const payload = service.buildHexPayload({ [cellA]: 0, [cellB]: -2 }, 7);

			expect(payload).toEqual({ res: 7, cells: [cellA, cellB] });
		});

		it('includes counts clamped to the 1-3 range when not all ones', () => {
			const payload = service.buildHexPayload({ [cellA]: 2, [cellB]: 99, [cellC]: 0 }, 6);

			expect(payload.cells).toEqual([cellA, cellB, cellC]);
			expect(payload.counts).toEqual([2, 3, 1]);
		});

		it('keeps the requested resolution', () => {
			expect(service.buildHexPayload({ [cellA]: 1 }, 6).res).toBe(6);
			expect(service.buildHexPayload({ [cellA]: 1 }, 7).res).toBe(7);
		});

		it('returns empty cells for an empty counts record', () => {
			expect(service.buildHexPayload({}, 6)).toEqual({ res: 6, cells: [] });
		});

		it('never sets the compact flag', () => {
			expect(service.buildHexPayload({ [cellA]: 2 }, 6).compact).toBeUndefined();
		});
	});

	describe('filterCellsByCountry', () => {
		// Bornes alignées sur les "départements" carrés de la fixture geojson
		const bounds: NeighboringCountryBounds = { code: 'D1', minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 };

		it('keeps only cells whose center falls inside the bounds', () => {
			const inside = latLngToCell(0.5, 0.5, 6);
			const outside = latLngToCell(2.5, 2.5, 6); // dans le carré 02, hors bornes D1
			const farAway = latLngToCell(43.6, 1.44, 6);

			const filtered = service.filterCellsByCountry({ [inside]: 2, [outside]: 1, [farAway]: 3 }, bounds);

			expect(filtered).toEqual({ [inside]: 2 });
		});

		it('preserves the original count values', () => {
			const a = latLngToCell(0.2, 0.2, 7);
			const b = latLngToCell(0.8, 0.8, 7);

			const filtered = service.filterCellsByCountry({ [a]: 3, [b]: 1 }, bounds);

			expect(filtered).toEqual({ [a]: 3, [b]: 1 });
		});

		it('excludes cells outside on a single axis (latitude or longitude)', () => {
			const latTooHigh = latLngToCell(2.5, 0.5, 6);
			const lonTooLow = latLngToCell(0.5, -1.5, 6);

			const filtered = service.filterCellsByCountry({ [latTooHigh]: 1, [lonTooLow]: 1 }, bounds);

			expect(filtered).toEqual({});
		});

		it('returns an empty record for empty input', () => {
			expect(service.filterCellsByCountry({}, bounds)).toEqual({});
		});
	});
});
