// src/services/GenericTypesetterService.ts
import { nanoid } from 'nanoid';

import { t } from '@/i18n';
import type {
	CompileArtifact,
	CompilerCapabilities,
	CompilerInputFile,
	CompilerOutputFormat,
	CompilerTransportConfig,
	CompilerUISchema,
} from '../types/compilation';
import { createNamedLogger } from '@/logging';

const moduleLog = createNamedLogger('GenericTypesetterService');

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';
type StatusListener = (configId: string, status: ConnectionStatus) => void;
type ServerInfoListener = (
	configId: string,
	info: TypesetterServerInfo | undefined,
) => void;

/** Runtime information reported by a compatible external typesetter. */
export interface TypesetterServerInfo {
	distribution: string;
	version?: string;
}

export interface TypesetterServerConfig {
	id: string;
	name: string;
	enabled: boolean;
	incrementalSync?: boolean;
	projectType: string;
	projectGroup?: string;
	inputExtensions: string[];
	inputFiles?: CompilerInputFile[];
	outputFormats: CompilerOutputFormat[];
	transportConfig: CompilerTransportConfig;
	capabilities: CompilerCapabilities;
	ui?: CompilerUISchema;
}

export interface TypesetterFile {
	path: string;
	content: Uint8Array;
	lastModified?: number;
}

interface ManifestEntry {
	path: string;
	hash: string;
}

interface HashCacheEntry {
	lastModified?: number;
	hash: string;
}

export interface TypesetterCompileRequest {
	mainFile: string;
	format: string;
	files: TypesetterFile[];
	options?: Record<string, string | number | boolean>;
}

export interface TypesetterCompileResult {
	status: number;
	log: string;
	format: string;
	mimeType?: string;
	output?: Uint8Array;
	artifacts?: CompileArtifact[];
}

interface Connection {
	socket: WebSocket;
	authToken?: string;
	pending: Map<
		string,
		{
			resolve: (result: TypesetterCompileResult) => void;
			reject: (error: Error) => void;
		}
	>;
}

const MISSING_FILES_STATUS = -2;

class GenericTypesetterService {
	private configs: Map<string, TypesetterServerConfig> = new Map();
	private connections: Map<string, Connection> = new Map();
	private connectionStatuses: Map<string, ConnectionStatus> = new Map();
	private statusListeners: Set<StatusListener> = new Set();
	private serverInfo: Map<string, TypesetterServerInfo> = new Map();
	private serverInfoListeners: Set<ServerInfoListener> = new Set();
	private hashCaches: Map<string, Map<string, HashCacheEntry>> = new Map();
	private sentHashes: Map<string, Map<string, string>> = new Map();

	registerConfig(config: TypesetterServerConfig): void {
		this.configs.set(config.id, config);
		this.setConnectionStatus(config.id, 'disconnected');
	}

	updateConfig(configId: string, config: TypesetterServerConfig): void {
		const existing = this.configs.get(configId);
		const transportChanged =
			!existing ||
			JSON.stringify(existing.transportConfig) !==
				JSON.stringify(config.transportConfig);

		if (transportChanged) {
			this.disconnect(configId);
			this.clearServerInfo(configId);
		}
		this.configs.set(configId, config);
		this.setConnectionStatus(
			config.id,
			!transportChanged &&
				this.connections.get(configId)?.socket.readyState === WebSocket.OPEN
				? 'connected'
				: 'disconnected',
		);
	}

	unregisterConfig(configId: string): void {
		this.disconnect(configId);
		this.configs.delete(configId);
		this.connectionStatuses.delete(configId);
		this.hashCaches.delete(configId);
		this.clearServerInfo(configId);
	}

	resetSyncState(configId: string): void {
		this.sentHashes.delete(configId);
	}

	getConfig(configId: string): TypesetterServerConfig | undefined {
		return this.configs.get(configId);
	}

	getConnectionStatus(configId: string): ConnectionStatus {
		return this.connectionStatuses.get(configId) ?? 'disconnected';
	}

	onStatusChange(listener: StatusListener): () => void {
		this.statusListeners.add(listener);
		return () => this.statusListeners.delete(listener);
	}

	getServerInfo(configId: string): TypesetterServerInfo | undefined {
		return this.serverInfo.get(configId);
	}

	onServerInfoChange(listener: ServerInfoListener): () => void {
		this.serverInfoListeners.add(listener);
		return () => this.serverInfoListeners.delete(listener);
	}

	async connect(configId: string): Promise<void> {
		const config = this.configs.get(configId);
		if (!config) {
			throw new Error(`Typesetter config not found: ${configId}`);
		}

		await this.ensureConnection(config);
	}

	async probe(
		configId: string,
		timeoutMs = 3_000,
	): Promise<TypesetterServerInfo> {
		await this.connect(configId);

		const existing = this.getServerInfo(configId);
		if (existing) return existing;

		const connection = this.connections.get(configId);
		if (!connection) throw new Error('Typesetter connection was not established');

		return new Promise<TypesetterServerInfo>((resolve, reject) => {
			const timeout = window.setTimeout(() => {
				unsubscribe();
				reject(new Error('Typesetter server did not report its capabilities'));
			}, timeoutMs);
			const unsubscribe = this.onServerInfoChange((reportedConfigId, info) => {
				if (reportedConfigId !== configId || !info) return;
				window.clearTimeout(timeout);
				unsubscribe();
				resolve(info);
			});

			this.requestServerInfo(connection);
		});
	}

	async compile(
		configId: string,
		request: TypesetterCompileRequest,
	): Promise<TypesetterCompileResult> {
		const config = this.configs.get(configId);
		if (!config) {
			throw new Error(`Typesetter config not found: ${configId}`);
		}

		const connection = await this.ensureConnection(config);

		if (!config.incrementalSync) {
			return this.send(connection, request, request.files);
		}

		const manifest = await this.buildManifest(configId, request.files);
		const sent = this.sentHashes.get(configId) ?? new Map<string, string>();
		const changed = request.files.filter(
			(file) => sent.get(file.path) !== manifest.get(file.path),
		);

		const result = await this.send(connection, request, changed, manifest);

		if (result.status === MISSING_FILES_STATUS) {
			this.sentHashes.delete(configId);
			return this.send(connection, request, request.files, manifest);
		}

		this.sentHashes.set(configId, manifest);
		return result;
	}

	cancelCompilation(configId: string): void {
		this.disconnect(configId, new Error('Compilation cancelled'));
	}

	private send(
		connection: Connection,
		request: TypesetterCompileRequest,
		files: TypesetterFile[],
		manifest?: Map<string, string>,
	): Promise<TypesetterCompileResult> {
		const requestId = nanoid();

		return new Promise<TypesetterCompileResult>((resolve, reject) => {
			connection.pending.set(requestId, { resolve, reject });
			connection.socket.send(
				JSON.stringify({
					requestId,
					...(connection.authToken
						? { authToken: connection.authToken }
						: {}),
					mainFile: request.mainFile,
					format: request.format,
					options: request.options ?? {},
					...(manifest
						? {
								manifest: Array.from(
									manifest,
									([path, hash]): ManifestEntry => ({
										path,
										hash,
									}),
								),
							}
						: {}),
					files: files.map((file) => ({
						path: file.path,
						content: this.encodeBytes(file.content),
					})),
				}),
			);
		});
	}

	private async buildManifest(
		configId: string,
		files: TypesetterFile[],
	): Promise<Map<string, string>> {
		const cache =
			this.hashCaches.get(configId) ?? new Map<string, HashCacheEntry>();
		const nextCache = new Map<string, HashCacheEntry>();
		const manifest = new Map<string, string>();

		for (const file of files) {
			const cached = cache.get(file.path);
			const reusable =
				cached !== undefined &&
				file.lastModified !== undefined &&
				cached.lastModified === file.lastModified;

			const hash = reusable
				? cached.hash
				: await this.hashContent(file.content);

			nextCache.set(file.path, { lastModified: file.lastModified, hash });
			manifest.set(file.path, hash);
		}

		this.hashCaches.set(configId, nextCache);
		return manifest;
	}

	private async hashContent(content: Uint8Array): Promise<string> {
		const buffer = content.buffer.slice(
			content.byteOffset,
			content.byteOffset + content.byteLength,
		) as ArrayBuffer;
		const digest = await crypto.subtle.digest('SHA-256', buffer);
		return Array.from(new Uint8Array(digest))
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('');
	}

	private async ensureConnection(
		config: TypesetterServerConfig,
	): Promise<Connection> {
		const existing = this.connections.get(config.id);
		if (existing && existing.socket.readyState === WebSocket.OPEN) {
			return existing;
		}

		if (config.transportConfig.type !== 'websocket') {
			throw new Error(
				`Unsupported typesetter transport: ${config.transportConfig.type}`,
			);
		}

		const transportUrl = config.transportConfig.url;
		if (!transportUrl) throw new Error(t('Typesetter transport URL is missing'));
		const url = this.normalizeWebSocketUrl(transportUrl);

		this.setConnectionStatus(config.id, 'connecting');
		const socket = new WebSocket(url);
		socket.binaryType = 'arraybuffer';
		const connection: Connection = {
			socket,
			pending: new Map(),
			...(config.transportConfig.authToken
				? { authToken: config.transportConfig.authToken }
				: {}),
		};
		this.connections.set(config.id, connection);

		socket.addEventListener('message', (event) => {
			this.handleMessage(config.id, connection, event.data);
		});
		socket.addEventListener('close', () => {
			if (this.connections.get(config.id) !== connection) return;
			this.failPending(config.id, new Error('Connection closed'));
			this.setConnectionStatus(config.id, 'disconnected');
			this.connections.delete(config.id);
			this.sentHashes.delete(config.id);
		});
		socket.addEventListener('error', () => {
			if (this.connections.get(config.id) === connection) {
				this.setConnectionStatus(config.id, 'error');
			}
		});

		await new Promise<void>((resolve, reject) => {
			socket.addEventListener('open', () => {
				this.setConnectionStatus(config.id, 'connected');
				if (config.capabilities.miktex === true) {
					this.requestServerInfo(connection);
				}
				resolve();
			});
			socket.addEventListener('error', () =>
				reject(
					new Error(
						t('Failed to connect to {provider}', { provider: t('typesetter') }),
					),
				),
			);
			socket.addEventListener('close', () =>
				reject(new Error('Connection closed')),
			);
		});

		return connection;
	}

	private handleMessage(
		configId: string,
		connection: Connection,
		data: unknown,
	): void {
		if (this.connections.get(configId) !== connection || typeof data !== 'string') {
			return;
		}

		let payload: {
			type?: string;
			requestId?: string;
			status?: number;
			log?: string;
			format?: string;
			mimeType?: string;
			output?: string;
			info?: {
				distribution?: unknown;
				version?: unknown;
			};
			artifacts?: Array<{
				id: string;
				name: string;
				mimeType?: string;
				data: string;
			}>;
		};
		try {
			payload = JSON.parse(data);
		} catch {
			return;
		}

		if (payload.type === 'info') {
			if (
				payload.status === 0 &&
				typeof payload.info?.distribution === 'string'
			) {
				this.setServerInfo(configId, {
					distribution: payload.info.distribution,
					...(typeof payload.info.version === 'string'
						? { version: payload.info.version }
						: {}),
				});
			}
			return;
		}

		if (typeof payload.requestId !== 'string') return;

		const handler = connection.pending.get(payload.requestId);
		if (!handler) return;
		connection.pending.delete(payload.requestId);

		handler.resolve({
			status: payload.status ?? 1,
			log: payload.log ?? '',
			format: payload.format ?? 'pdf',
			mimeType: payload.mimeType,
			output: payload.output ? this.decodeBytes(payload.output) : undefined,
			artifacts: payload.artifacts?.map((artifact) => ({
				id: artifact.id,
				name: artifact.name,
				mimeType: artifact.mimeType,
				data: this.decodeBytes(artifact.data),
			})),
		});
	}

	private disconnect(
		configId: string,
		error: Error = new Error('Connection reset'),
	): void {
		this.sentHashes.delete(configId);
		const connection = this.connections.get(configId);
		if (!connection) return;
		this.failPending(configId, error);
		connection.socket.close();
		this.connections.delete(configId);
	}

	private failPending(configId: string, error: Error): void {
		const connection = this.connections.get(configId);
		if (!connection) return;
		connection.pending.forEach((handler) => {
			handler.reject(error);
		});
		connection.pending.clear();
	}

	private setConnectionStatus(
		configId: string,
		status: ConnectionStatus,
	): void {
		this.connectionStatuses.set(configId, status);
		this.statusListeners.forEach((listener) => {
			try {
				listener(configId, status);
			} catch (error) {
				moduleLog.error('Status listener error:', error);
			}
		});
	}

	private requestServerInfo(connection: Connection): void {
		try {
			connection.socket.send(
				JSON.stringify({
					type: 'info',
					requestId: nanoid(),
					...(connection.authToken
						? { authToken: connection.authToken }
						: {}),
				}),
			);
		} catch (error) {
			moduleLog.debug('Failed to request external typesetter information:', error);
		}
	}

	private normalizeWebSocketUrl(url: string): string {
		let parsed: URL;
		try {
			parsed =
				typeof window === 'undefined'
					? new URL(url)
					: new URL(url, window.location.origin);
		} catch {
			throw new Error(t('Typesetter transport URL is invalid'));
		}

		if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
		if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
		if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
			throw new Error(t('Typesetter transport URL must use HTTP or WebSocket'));
		}

		return parsed.toString();
	}

	private setServerInfo(configId: string, info: TypesetterServerInfo): void {
		this.serverInfo.set(configId, info);
		this.serverInfoListeners.forEach((listener) => {
			try {
				listener(configId, info);
			} catch (error) {
				moduleLog.error('Typesetter server info listener error:', error);
			}
		});
	}

	private clearServerInfo(configId: string): void {
		if (!this.serverInfo.delete(configId)) return;
		this.serverInfoListeners.forEach((listener) => {
			try {
				listener(configId, undefined);
			} catch (error) {
				moduleLog.error('Typesetter server info listener error:', error);
			}
		});
	}

	private encodeBytes(bytes: Uint8Array): string {
		const chunkSize = 0x8000;
		const chunks: string[] = [];
		for (let i = 0; i < bytes.length; i += chunkSize) {
			chunks.push(
				String.fromCharCode.apply(
					null,
					bytes.subarray(i, i + chunkSize) as unknown as number[],
				),
			);
		}
		return btoa(chunks.join(''));
	}

	private decodeBytes(encoded: string): Uint8Array {
		const binary = atob(encoded);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}
}

export const genericTypesetterService = new GenericTypesetterService();
