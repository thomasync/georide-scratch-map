export interface Tracker {
	trackerId: number;
	trackerName: string;
	model: string;
	activationDate: string;
	odometer: number;
	latitude: number;
	longitude: number;
	speed: number;
	moving: boolean;
	isLocked: boolean;
	status: string;
	timezone: string;
	fixtime: string;
	altitude: number;
	externalBatteryVoltage: number;
	internalBatteryVoltage: number;
}
