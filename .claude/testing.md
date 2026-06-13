# Testing — georide-scratch-map

Angular 22 (zoneless, MapLibre, H3). Test stack: Vitest (unit) + Playwright (e2e).

## Tests & regressions — IMPORTANT

Whenever a feature or fix is implemented, **run the tests before concluding** and report any regression:

1. **Always** after a code change: `npm test` (unit suite, ~4s). Do not finish the task without it being green.
2. **If the change touches** the map, stats (`stats-utils.ts`, `stats-modal`), sharing, login or demo mode: also run `npm run e2e`.
3. If a test fails because of the new (expected) behavior, **update the test** rather than working around it. If it fails unexpectedly, that's a regression: fix it or flag it explicitly.
4. For new pure logic (utils, calculations), **write the matching unit test** in the same change.

Husky hooks already run `npm test` on commit and `npm run e2e` on push, but check for regressions *while* working, not only at commit time.

For manual exploratory QA in a real browser (driven via Chrome DevTools), follow the scenarios in `e2e/AI-CHECKLIST.md`.

## Environment

- **Node ≥ 24.15 required** (Angular 22 CLI). Before any `npm`/`ng` command, load nvm:
  `source ~/.nvm/nvm.sh && nvm use default`
- Otherwise `ng` fails with "requires a minimum Node.js version".

## Commands

- `npm test` — unit tests (Vitest, `ng test --watch=false`)
- `npm run test:coverage` — + coverage report
- `npm run e2e` — Playwright tests (starts `ng serve` on its own)
- `npm run build` — production build
- `npm start` — dev server (:4200)

## Testing conventions

- **Zoneless**: no `fakeAsync`/`tick` (zone.js is absent). Use `vi.useFakeTimers()`, `await fixture.whenStable()`, `TestBed.tick()` to flush `effect()`.
- Shared test infra in `src/test/`: `setup.ts` (Worker stub, fake-indexeddb), `fixtures/`, `helpers/providers.ts` (`provideSilentLogger`, `createDatabaseServiceMock`).
- **Don't test logger calls** (`expect(logger.log).toHaveBeenCalled` is noise) — provide `provideSilentLogger()` and assert real behavior instead.
- The builder runs with `isolate: true` (per-spec-file isolation).
- Coverage excludes `map.ts`, `trip-detail-panel/`, `screenshot.ts` (too coupled to MapLibre/canvas). Pure stats logic lives in `stats-utils.ts` and **must** stay tested.
