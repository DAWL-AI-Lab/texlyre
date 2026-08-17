import {
	genericTypesetterService,
	type TypesetterServerConfig,
} from '@src/services/GenericTypesetterService';

class MockWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSED = 3;
	static instances: MockWebSocket[] = [];

	readonly sent: string[] = [];
	readonly url: string;
	readyState = MockWebSocket.CONNECTING;
	private listeners = new Map<string, Set<(event: Event) => void>>();

	constructor(url: string) {
		this.url = url;
		MockWebSocket.instances.push(this);
		queueMicrotask(() => {
			this.readyState = MockWebSocket.OPEN;
			this.emit('open');
		});
	}

	addEventListener(type: string, listener: (event: Event) => void): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	send(message: string): void {
		this.sent.push(message);
	}

	close(): void {
		this.readyState = MockWebSocket.CLOSED;
		this.emit('close');
	}

	respond(response: object): void {
		this.emit(
			'message',
			new MessageEvent('message', { data: JSON.stringify(response) }),
		);
	}

	private emit(type: string, event: Event = new Event(type)): void {
		this.listeners.get(type)?.forEach((listener) => listener(event));
	}
}

const config: TypesetterServerConfig = {
	id: 'test-typesetter',
	name: 'Test typesetter',
	enabled: true,
	projectType: 'latex',
	inputExtensions: ['.tex'],
	outputFormats: [{ id: 'pdf', mimeType: 'application/pdf' }],
	transportConfig: { type: 'websocket', url: 'ws://test-typesetter' },
	capabilities: {},
};

const flushPromises = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};

describe('GenericTypesetterService cancellation', () => {
	const originalWebSocket = global.WebSocket;

	beforeEach(() => {
		MockWebSocket.instances = [];
		global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
		genericTypesetterService.registerConfig(config);
	});

	afterEach(() => {
		genericTypesetterService.unregisterConfig(config.id);
	});

	afterAll(() => {
		global.WebSocket = originalWebSocket;
	});

	it('cancels a pending compile by closing its connection', async () => {
		const compilation = genericTypesetterService.compile(config.id, {
			mainFile: '/main.tex',
			format: 'pdf',
			files: [],
		});
		await flushPromises();

		genericTypesetterService.cancelCompilation(config.id);

		await expect(compilation).rejects.toThrow('Compilation cancelled');
		expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CLOSED);
	});

	it('allows a replacement compile after cancellation', async () => {
		const cancelledCompilation = genericTypesetterService.compile(config.id, {
			mainFile: '/main.tex',
			format: 'pdf',
			files: [],
		});
		await flushPromises();
		genericTypesetterService.cancelCompilation(config.id);

		const replacementCompilation = genericTypesetterService.compile(config.id, {
			mainFile: '/main.tex',
			format: 'pdf',
			files: [],
		});
		await flushPromises();

		const replacementSocket = MockWebSocket.instances[1];
		const { requestId } = JSON.parse(replacementSocket.sent[0]) as {
			requestId: string;
		};
		replacementSocket.respond({
			requestId,
			status: 0,
			log: '',
			format: 'pdf',
		});

		await expect(cancelledCompilation).rejects.toThrow('Compilation cancelled');
		await expect(replacementCompilation).resolves.toMatchObject({ status: 0 });
	});

	it('discovers a same-origin MiKTeX endpoint before registering it', async () => {
		genericTypesetterService.updateConfig(config.id, {
			...config,
			transportConfig: { type: 'websocket', url: '/texlyre-typesetter' },
			capabilities: { miktex: true },
		});

		const discovery = genericTypesetterService.probe(config.id);
		await flushPromises();

		const socket = MockWebSocket.instances[0];
		expect(socket.url).toBe('ws://localhost/texlyre-typesetter');
		const infoRequests = socket.sent
			.map((message) => JSON.parse(message) as { type?: string; requestId: string })
			.filter((request) => request.type === 'info');
		expect(infoRequests).toHaveLength(2);
		socket.respond({
			type: 'info',
			requestId: infoRequests.at(-1)?.requestId,
			status: 0,
			info: { distribution: 'MiKTeX', version: 'MiKTeX 26.5' },
		});

		await expect(discovery).resolves.toEqual({
			distribution: 'MiKTeX',
			version: 'MiKTeX 26.5',
		});
	});

	it('sends the complete project and maps a remote PDF, log, and artifacts', async () => {
		genericTypesetterService.updateConfig(config.id, {
			...config,
			transportConfig: {
				...config.transportConfig,
				url: 'http://test-typesetter',
				authToken: 'test-access-token',
			},
			capabilities: { miktex: true },
		});

		const compilation = genericTypesetterService.compile(config.id, {
			mainFile: '/main.tex',
			format: 'pdf',
			files: [
				{
					path: '/main.tex',
					content: new TextEncoder().encode('\\documentclass{article}'),
				},
			],
			options: { engine: 'pdflatex' },
		});
		await flushPromises();

		const socket = MockWebSocket.instances[0];
		expect(socket.url).toBe('ws://test-typesetter/');
		const infoRequest = JSON.parse(
			socket.sent.find((message) => JSON.parse(message).type === 'info') ?? '',
		) as { requestId: string; authToken: string };
		expect(infoRequest.authToken).toBe('test-access-token');
		socket.respond({
			type: 'info',
			requestId: infoRequest.requestId,
			status: 0,
			info: { distribution: 'MiKTeX', version: 'MiKTeX 26.5' },
		});
		expect(genericTypesetterService.getServerInfo(config.id)).toEqual({
			distribution: 'MiKTeX',
			version: 'MiKTeX 26.5',
		});

		const request = JSON.parse(
			socket.sent.find((message) => JSON.parse(message).type !== 'info') ?? '',
		) as {
			requestId: string;
			authToken: string;
			files: Array<{ path: string; content: string }>;
			options: { engine: string };
		};
		expect(request.authToken).toBe('test-access-token');
		expect(request.options.engine).toBe('pdflatex');
		expect(request.files).toEqual([
			{
				path: '/main.tex',
				content: btoa('\\documentclass{article}'),
			},
		]);

		socket.respond({
			requestId: request.requestId,
			status: 0,
			log: 'remote MiKTeX log',
			format: 'pdf',
			mimeType: 'application/pdf',
			output: btoa('%PDF'),
			artifacts: [
				{
					id: 'synctex',
					name: 'main.synctex.gz',
					mimeType: 'application/gzip',
					data: btoa('synctex'),
				},
			],
		});

		await expect(compilation).resolves.toMatchObject({
			status: 0,
			log: 'remote MiKTeX log',
			mimeType: 'application/pdf',
			output: new Uint8Array([37, 80, 68, 70]),
			artifacts: [
				{
					id: 'synctex',
					name: 'main.synctex.gz',
					data: new Uint8Array([115, 121, 110, 99, 116, 101, 120]),
				},
			],
		});
	});
});
