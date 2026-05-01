export interface Position {
	lat: number;
	lon: number;
	alt?: number;
	speed?: number;
	time: string;
}

export interface PositionsLink {
	url: string;
	expiresAt: string;
}
