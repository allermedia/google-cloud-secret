declare module '@aller/google-cloud-secret' {
	import type { default as secretManager } from '@google-cloud/secret-manager';
	import type { LRUCache } from 'lru-cache';
	export class ConcurrentSecretError extends Error {
		
		constructor(message: string, code: import("google-gax").Status);
		
		code: import("google-gax").Status;
	}
	export class ConcurrentSecret {
		/**
		 * @param name secret resource name, e.g. `projects/1234/secrets/concurrent-test-secret`
		 * @param clientOrClientOptions Secret Manager client instance or the options for a new one
		 * @param options options
		 */
		constructor(name: string, clientOrClientOptions?: import("google-gax").ClientOptions | import("@google-cloud/secret-manager").v1.SecretManagerServiceClient, options?: concurrentSecretOptions);
		name: string;
		latestVersionName: string;
		client: secretManager.v1.SecretManagerServiceClient;
		
		secret: import("@google-cloud/secret-manager").protos.google.cloud.secretmanager.v1.ISecret | undefined;
		
		pendingSecret: Promise<import("@google-cloud/secret-manager").protos.google.cloud.secretmanager.v1.ISecret> | undefined;
		/**
		 * Updated version name
		 * */
		updatedVersionName: string | undefined;
		/** @type {concurrentSecretOptions} [gracePeriodMs] Lock grace period in milliseconds, continue if secret is locked beyond grace period */
		options: concurrentSecretOptions;
		/**
		 * Get latest version
		 * 
		 */
		getLatestVersion(throwOnNotFound?: boolean): Promise<secretManager.protos.google.cloud.secretmanager.v1.ISecretVersion>;
		/**
		 * Get latest version secret data
		 * 
		 */
		getLatestData(throwOnNotFound?: boolean): Promise<secretManager.protos.google.cloud.secretmanager.v1.IAccessSecretVersionResponse>;
		/**
		 * Update secret with new version. Destroy the previous version on successful update.
		 * @param fn get new secret function, call this function if a lock was acheieved
		 * @param  args optional arguments to function
		 * @returns new secret version data
		 */
		optimisticUpdate(fn: (...args: any) => Promise<string | Buffer> | string | Buffer, ...args: any[]): Promise<string | Buffer>;
		/**
		 * Lock secret by updating it so that it rotates etag
		 * @returns locked secret
		 */
		lock(): Promise<secretManager.protos.google.cloud.secretmanager.v1.ISecret>;
		/**
		 * Unlock secret
		 */
		unlock(): Promise<void>;
		/**
		 * @internal Prepare optimistic update
		 */
		_prepare(): Promise<secretManager.protos.google.cloud.secretmanager.v1.ISecret>;
		/**
		 * @internal Get gax call options
		 * */
		_updateSecret(secret: import("@google-cloud/secret-manager").protos.google.cloud.secretmanager.v1.ISecret): Promise<[secretManager.protos.google.cloud.secretmanager.v1.ISecret, secretManager.protos.google.cloud.secretmanager.v1.IUpdateSecretRequest, {}]>;
		/**
		 * @internal Get gax call options
		 * */
		_getCallOptions(): import("google-gax").CallOptions;
	}
	export class CachedSecret extends ConcurrentSecret {
		
		constructor(name: string, initialValue: string, options: cachedSecretOptions & concurrentSecretOptions);
		/**
		 * Secret value
		 * */
		value: string;
		/**
		 * Update secret value function
		 * */
		updateMethod: (...args: any) => Promise<string | Buffer> | string | Buffer;
		/**
		 * Current version name
		 * */
		versionName: string | undefined;
		/**
		 * Use method to get new secret value, missing method fetches latest version data
		 * */
		update(...args: any[]): Promise<string>;
		/**
		 * Update cached secret value and version name
		 * */
		_updateCachedSecret(...args: any[]): Promise<string>;
		/**
		 * Clone current secret with new value
		 * */
		clone(newValue: string | Buffer): CachedSecret;
	}
	export class SecretsCache {
		/**
		 * @param clientOrClientOptions Secret Manager client instance or the options for a new one
		 * @param cacheOptions LRU Cache options
		 */
		constructor(clientOrClientOptions?: import("google-gax").ClientOptions | import("@google-cloud/secret-manager").v1.SecretManagerServiceClient, cacheOptions?: Omit<LRUCache.Options<string, CachedSecret, any>, "fetchMethod">);
		client: import("@google-cloud/secret-manager").v1.SecretManagerServiceClient;
		cache: LRUCache<string, CachedSecret, any>;
		/**
		 * Get cached secret
		 * */
		get(name: string): Promise<CachedSecret>;
		/**
		 * Has cached secret
		 * */
		has(name: string): boolean;
		/**
		 * Set cached secret
		 * @param initialValue initial value
		 * @param updateMethod function to use when to update secret with new value, if omitted return latest secret version data
		 * @param options cached secret options, plus ttl which is passed to underlying cache
		 */
		set(name: string, initialValue?: string, updateMethod?: (options: LRUCache.FetcherOptions<string, CachedSecret, any>) => Promise<string | Buffer> | string | Buffer, options?: concurrentSecretOptions & cachedSetSecretOptions): void;
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
		callOptions?: (() => import("google-gax").CallOptions) | import("google-gax").CallOptions;
	};
	export type cachedSetSecretOptions = {
		/**
		 * Time to live
		 */
		ttl?: number;
	};
	export type cachedSecretOptions = {
		/**
		 * use this method to update with new secret value
		 */
		updateMethod?: (...args: any) => Promise<string | Buffer> | string | Buffer;
		/**
		 * Secret Manager client instance or the options for a new one
		 */
		client?: import("google-gax").ClientOptions | import("@google-cloud/secret-manager").v1.SecretManagerServiceClient;
		/**
		 * version name
		 */
		versionName?: string;
	};

	export {};
}

declare module '@aller/google-cloud-secret/fake-server/fake-secret-manager-server' {
	import type { protos as protos_1 } from '@google-cloud/secret-manager';
	import type { Metadata } from '@grpc/grpc-js';
	/**
	 * Start fake server with its own secret store, or a prefilled one passed in options
	 * @param options Fake gRPC server options
	 * @returns Fake gRPC Google Secret Manager server
	 */
	export function startServer(options?: startServerOptions): Promise<FakeSecretManagerServer>;
	/**
	 * Fake Secret Manager service implementation
	 */
	export class FakeSecretManager {
		/**
		 * @param secrets backing secret store, e.g. prefilled with secrets, defaults to a new empty store
		 */
		constructor(secrets?: Map<string, FakeSecretData>);
		
		secrets: Map<string, FakeSecretData>;
		
		CreateSecret(req: AddSecretRequest, respond: CallableFunction): any;
		
		GetSecret(req: GetSecretRequest, respond: CallableFunction): any;
		
		AddSecretVersion(req: AddSecretVersionRequest, respond: CallableFunction): any;
		/**
		 * Disable version, the method is idempotent but etag is updated
		 * */
		DisableSecretVersion(req: DisableSecretVersionRequest, respond: CallableFunction): any;
		/**
		 * Enable version, the method is idempotent but etag is updated
		 * */
		EnableSecretVersion(req: EnableSecretVersionRequest, respond: CallableFunction): any;
		/**
		 * Get secret version
		 * */
		GetSecretVersion(req: any, respond: CallableFunction): any;
		/**
		 * List secret versions
		 * */
		ListSecretVersions(req: any, respond: CallableFunction): any;
		/**
		 * Destroy secret version
		 * */
		DestroySecretVersion(req: any, respond: CallableFunction): any;
		/**
		 * Update secret, the method is idempotent but etag is updated
		 * */
		UpdateSecret(req: UpdatesSecretRequest, respond: CallableFunction): any;
		/**
		 * Access secret version data
		 * */
		AccessSecretVersion(req: AccessSecretVersionRequest, respond: CallableFunction): any;
		/**
		 * Delete secret
		 * */
		DeleteSecret(req: DeleteSecretRequest, respond: CallableFunction): any;
	}
	export type FakeSecretManagerServer = import("@grpc/grpc-js").Server & {
		origin: {
			hostname: string;
			port: number;
		};
		secrets: Map<string, FakeSecretData>;
		getSecret: (name: string) => FakeSecretData | undefined;
		reset: () => void;
	};
	export type startServerOptions = {
		/**
		 * server TLS certs, e.g. from mkcert, starts a TLS server
		 */
		cert?: import("@grpc/grpc-js").KeyCertPair[];
		/**
		 * server credentials, takes precedence over cert; defaults to SSL credentials built from cert, or insecure credentials when neither is given — then connect the client with `sslCreds: grpc.credentials.createInsecure()`
		 */
		credentials?: import("@grpc/grpc-js").ServerCredentials;
		/**
		 * gRPC server port, defaults to 0 which lets the OS assign a free port
		 */
		port?: number;
		/**
		 * backing secret store, e.g. prefilled with secrets, defaults to a new empty store
		 */
		secrets?: Map<string, FakeSecretData>;
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
  interface AddSecretRequest {
	request: protos_1.google.cloud.secretmanager.v1.CreateSecretRequest;
	metadata: Metadata;
  }

  interface GetSecretRequest {
	request: protos_1.google.cloud.secretmanager.v1.GetSecretRequest;
	metadata: Metadata;
  }

  interface DisableSecretVersionRequest {
	request: protos_1.google.cloud.secretmanager.v1.DisableSecretVersionRequest;
	metadata: Metadata;
  }

  interface EnableSecretVersionRequest {
	request: protos_1.google.cloud.secretmanager.v1.EnableSecretVersionRequest;
	metadata: Metadata;
  }

  interface AddSecretVersionRequest {
	request: protos_1.google.cloud.secretmanager.v1.AddSecretVersionRequest;
	metadata: Metadata;
  }

  interface UpdatesSecretRequest {
	request: protos_1.google.cloud.secretmanager.v1.UpdateSecretRequest;
	metadata: Metadata;
  }

  interface AccessSecretVersionRequest {
	request: protos_1.google.cloud.secretmanager.v1.IAccessSecretVersionRequest;
	metadata: Metadata;
  }

  interface DeleteSecretRequest {
	request: protos_1.google.cloud.secretmanager.v1.IDeleteSecretRequest;
	metadata: Metadata;
  }

	export {};
}

//# sourceMappingURL=index.d.ts.map