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
	readyState = MockWebSocket.CONNECTING;
	private listeners = new Map<string, Set<(event: Event) => void>>();

	constructor(_url: string) {
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
});
