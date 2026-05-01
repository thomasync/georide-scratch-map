export interface User {
	id: number;
	email: string;
	firstName: string;
	createdAt: string;
	phoneNumber: string;
	pushUserToken: string | null;
	legal: boolean;
	legalSocial: boolean;
	dateOfBirth: string;
	isDemo: boolean;
	helpCenterType: string;
	region: string;
}

export interface AuthLoginResponse {
	id: number;
	email: string;
	isAdmin: boolean;
	authToken: string;
	updatedAt: string;
}
