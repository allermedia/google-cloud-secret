declare module '@aller/google-cloud-secret' {
	export class ConcurrentSecretError extends Error {
		
		constructor(message: string, code: import("google-gax").Status);
		
		code: import("google-gax").Status;
	}
	export default class ConcurrentSecret_1 {
		/**
		 * @param name secret resource name, e.g. `projects/1234/secrets/concurrent-test-secret`
		 * @param gracePeriodMs lock grace period in milliseconds, continue if secret is locked beyond grace period
		 */
		constructor(name: string, clientOptions?: import("google-gax").ClientOptions | import("@google-cloud/secret-manager").v1.SecretManagerServiceClient, gracePeriodMs?: number);
		name: string;
		latestVersionName: string;
		client: import("@google-cloud/secret-manager/build/src/v1").SecretManagerServiceClient;
		
		secret: import("@google-cloud/secret-manager").protos.google.cloud.secretmanager.v1.ISecret | undefined;
		
		pendingSecret: Promise<import("@google-cloud/secret-manager").protos.google.cloud.secretmanager.v1.ISecret> | undefined;
		
		secretVersion: import("@google-cloud/secret-manager").protos.google.cloud.secretmanager.v1.ISecretVersion | undefined;
		/** @type {number} [gracePeriodMs] Lock grace period in milliseconds, continue if secret is locked beyond grace period */
		gracePeriodMs: number;
		/**
		 * Prepare optimistic update
		 * */
		_prepare(): Promise<import("@google-cloud/secret-manager/build/protos/protos").google.cloud.secretmanager.v1.ISecret>;
		/**
		 * Get latest version
		 * 
		 */
		getLatestVersion(throwOnNotFound?: boolean): Promise<import("@google-cloud/secret-manager/build/protos/protos").google.cloud.secretmanager.v1.ISecretVersion>;
		/**
		 * Get latest version secret data
		 */
		getLatestData(): Promise<import("@google-cloud/secret-manager/build/protos/protos").google.cloud.secretmanager.v1.IAccessSecretVersionResponse>;
		/**
		 * @param fn get new secret function, call this function if a lock was acheieved
		 * @param  args optional arguments to function
		 * @returns new secret version data
		 */
		optimisticUpdate(fn: (...args: any) => Promise<string | Buffer>, ...args: any[]): Promise<string | Buffer>;
		/**
		 * Lock secret by updating it so that it rotates etag
		 * @returns locked secret
		 */
		lock(): Promise<import("@google-cloud/secret-manager/build/protos/protos").google.cloud.secretmanager.v1.ISecret>;
		/**
		 * Unlock secret
		 */
		unlock(): Promise<void>;
	}

	export {};
}

declare module '@aller/google-cloud-secret/fake-server/fake-secret-manager-server' {
	/**
	 * Start fake server
	 * @param options Fake gRPC server options
	 * @returns Fake gRPC Google Secret Manager server
	 */
	export default function startServer_1(options: startServerOptions): Promise<import("@grpc/grpc-js").Server>;
	/**
	 * Reset all fake secrets and versions
	 */
	export function reset(): void;
	export type startServerOptions = {
		/**
		 * secret manages sends credentials, hence certs need to be passed
		 */
		cert: import("@grpc/grpc-js").KeyCertPair[];
		/**
		 * gRPC server port, default to random 50NNN something
		 */
		port?: number;
	};
	export type FakeSecretVersion = {
		/**
		 * secret versions
		 */
		version: import("@google-cloud/secret-manager").protos.google.cloud.secretmanager.v1.ISecretVersion;
		/**
		 * secret data
		 */
		data?: Buffer;
	};
	export type FakeSecretData = {
		/**
		 * Secret
		 */
		secret: import("@google-cloud/secret-manager").protos.google.cloud.secretmanager.v1.ISecret;
		/**
		 * secret versions
		 */
		versions: FakeSecretVersion[];
	};
	export namespace RpcCodes {
		let OK: number;
		let CANCELLED: number;
		let UNKNOWN: number;
		let INVALID_ARGUMENT: number;
		let DEADLINE_EXCEEDED: number;
		let NOT_FOUND: number;
		let ALREADY_EXISTS: number;
		let PERMISSION_DENIED: number;
		let UNAUTHENTICATED: number;
		let RESOURCE_EXHAUSTED: number;
		let FAILED_PRECONDITION: number;
		let ABORTED: number;
		let OUT_OF_RANGE: number;
		let UNIMPLEMENTED: number;
		let INTERNAL: number;
		let UNAVAILABLE: number;
		let DATA_LOSS: number;
	}

	export {};
}

//# sourceMappingURL=index.d.ts.map