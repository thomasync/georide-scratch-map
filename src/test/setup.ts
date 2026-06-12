import { IDBFactory } from 'fake-indexeddb';

// jsdom n'implémente pas Worker — H3Service en instancie un en initialiseur de champ
class WorkerStub {
	onmessage: ((ev: MessageEvent) => void) | null = null;
	onerror: ((ev: ErrorEvent) => void) | null = null;
	constructor(..._args: unknown[]) {}
	postMessage(_msg: unknown): void {}
	addEventListener(_type: string, _listener: EventListener): void {}
	removeEventListener(_type: string, _listener: EventListener): void {}
	terminate(): void {}
}
globalThis.Worker = WorkerStub as unknown as typeof Worker;

// jsdom n'implémente pas matchMedia
if (typeof window !== 'undefined' && !window.matchMedia) {
	window.matchMedia = (query: string): MediaQueryList =>
		({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		}) as unknown as MediaQueryList;
}

// Le builder tourne avec isolate:false — chaque test repart d'une base IndexedDB vierge
beforeEach(() => {
	globalThis.indexedDB = new IDBFactory();
});
