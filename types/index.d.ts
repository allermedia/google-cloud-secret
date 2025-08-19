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
		getLatestVersion(throwOnNotFound?: boolean): Promise<import("@google-cloud/secret-manager/build/protos/protos").google.cloud.secretmanager.v1.ISecretVersion | null>;
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

//# sourceMappingURL=index.d.ts.map