export interface Trip {
	id: number;
	trackerId: number;
	distance: number;
	duration: number;
	averageSpeed: number;
	maxSpeed: number;
	startTime: string;
	endTime: string;
	startLat: number;
	startLon: number;
	endLat: number;
	endLon: number;
	startAddress: string;
	niceStartAddress: string | null;
	endAddress: string;
	niceEndAddress: string | null;
	staticImage: string;
	maxAngle: number;
	maxLeftAngle: number | null;
	maxRightAngle: number | null;
	averageAngle: number | null;
	isFavorite: boolean;
}
