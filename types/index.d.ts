declare module '@aller/google-cloud-secret' {
	import type { LRUCache } from 'lru-cache';
	export class ConcurrentSecretError extends Error {
		
		constructor(message: string, code: import("google-gax").Status);
		
		code: import("google-gax").Status;
	}
	export default class ConcurrentSecret_1 {
		/**
		 * @param name secret resource name, e.g. `projects/1234/secrets/concurrent-test-secret`
		 * @param clientOptions Secret Manager client instance or the options for a new one
		 * @param options options
		 */
		constructor(name: string, clientOptions?: import("google-gax").ClientOptions | import("@google-cloud/secret-manager").v1.SecretManagerServiceClient, options?: concurrentSecretOptions);
		name: string;
		latestVersionName: string;
		client: import("@google-cloud/secret-manager/build/src/v1").SecretManagerServiceClient;
		
		secret: import("@google-cloud/secret-manager").protos.google.cloud.secretmanager.v1.ISecret | undefined;
		
		pendingSecret: Promise<import("@google-cloud/secret-manager").protos.google.cloud.secretmanager.v1.ISecret> | undefined;
		
		secretVersion: import("@google-cloud/secret-manager").protos.google.cloud.secretmanager.v1.ISecretVersion | undefined;
		/** @type {concurrentSecretOptions} [gracePeriodMs] Lock grace period in milliseconds, continue if secret is locked beyond grace period */
		options: concurrentSecretOptions;
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
		/**
		 * @internal Prepare optimistic update
		 */
		_prepare(): Promise<import("@google-cloud/secret-manager/build/protos/protos").google.cloud.secretmanager.v1.ISecret>;
		/**
		 * @internal Get gax call options
		 * */
		_updateSecret(secret: import("@google-cloud/secret-manager").protos.google.cloud.secretmanager.v1.ISecret): Promise<[import("@google-cloud/secret-manager/build/protos/protos").google.cloud.secretmanager.v1.ISecret, import("@google-cloud/secret-manager/build/protos/protos").google.cloud.secretmanager.v1.IUpdateSecretRequest, {}]>;
		/**
		 * @internal Get gax call options
		 * */
		_getCallOptions(): import("google-gax").CallOptions;
	}
	export class CachedSecret extends ConcurrentSecret_1 {
		/**
		 * @param fetchMethod use this method to fetch new secret value
		 * 
		 */
		constructor(name: string, initialValue: string, fetchMethod?: (...args: any) => Promise<string | Buffer>, clientOptions?: import("google-gax").ClientOptions | import("@google-cloud/secret-manager").v1.SecretManagerServiceClient, options?: concurrentSecretOptions);
		value: string;
		
		fetchMethod: (...args: any) => Promise<string | Buffer>;
		/**
		 * Use fetchMethod to get new secret value, missing method fetches latest version data
		 * */
		update(...args: any[]): Promise<string>;
	}
	export class SecretsCache {
		/**
		 * @param clientOptions Secret Manager client instance or the options for a new one
		 * @param cacheOptions LRU Cache options
		 */
		constructor(clientOptions?: import("google-gax").ClientOptions | import("@google-cloud/secret-manager").v1.SecretManagerServiceClient, cacheOptions?: Omit<LRUCache.Options<string, CachedSecret, any>, "fetchMethod">);
		client: import("@google-cloud/secret-manager").v1.SecretManagerServiceClient;
		cache: LRUCache<string, CachedSecret, any>;
		/**
		 * Get cached secret
		 * */
		get(name: string): Promise<CachedSecret>;
		/**
		 * Set cached secret
		 * @param initialValue initial value
		 * @param updateMethod function to use when to update secret with new value, if omitted return latest secret version data
		 * @param options cached secret options, plus ttl which is passed to underlying cache
		 */
		set(name: string, initialValue?: string, updateMethod?: (options: LRUCache.FetcherOptions<string, CachedSecret, any>) => Promise<string | Buffer>, options?: concurrentSecretOptions & cachedSecretOptions): void;
		/**
		 * Update secret and return cached secret with new value
		 * */
		update(name: string): Promise<CachedSecret>;
		/**
		 * Get cached secret remaining ttl
		 * */
		getRemainingTTL(name: string): number;
	}
	export type concurrentSecretOptions = {
		/**
		 * lock grace period in milliseconds, continue if secret is locked beyond grace period, default is 60000ms
		 */
		gracePeriodMs?: number;
		/**
		 * optional function to pass other args to pass to each request, tracing for instance
		 */
		callOptions?: () => import("google-gax").CallOptions | import("google-gax").CallOptions;
	};
	export type cachedSecretOptions = {
		/**
		 * Time to live
		 */
		ttl?: number;
	};

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
	/**
	 * Get fake secret
	 * @param name secret name
	 */
	export function getSecret(name: string): FakeSecretData;
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
		/**
		 * last request metadata
		 */
		metadata: import("@grpc/grpc-js").Metadata;
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