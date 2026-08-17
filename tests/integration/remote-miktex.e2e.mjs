import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { WebSocket } from 'ws';

const token = 'remote-miktex-e2e-token';
const latexmk = spawnSync('latexmk', ['-v'], { stdio: 'ignore' });
if (latexmk.error || latexmk.status !== 0) {
	console.log('Skipping remote MiKTeX E2E test because latexmk is unavailable.');
	process.exit(0);
}

const server = spawn(process.execPath, ['scripts/local-latex-typesetter.mjs'], {
	cwd: process.cwd(),
	env: {
		...process.env,
		TEXLYRE_TYPESETTER_HOST: '127.0.0.1',
		TEXLYRE_TYPESETTER_PORT: '0',
		TEXLYRE_TYPESETTER_TOKEN: token,
	},
	stdio: ['ignore', 'pipe', 'pipe'],
});

const stopServer = async () => {
	if (server.exitCode !== null || server.killed) return;
	server.kill();
	await once(server, 'exit');
};

const getAvailablePort = () =>
	new Promise((resolve, reject) => {
		const listener = net.createServer();
		listener.once('error', reject);
		listener.listen(0, '127.0.0.1', () => {
			const address = listener.address();
			if (!address || typeof address === 'string') {
				reject(new Error('Could not reserve a Vite test port.'));
				return;
			}
			listener.close((error) => {
				if (error) reject(error);
				else resolve(address.port);
			});
		});
	});

const startViteProxy = async (typesetterUrl, useHttps = false) => {
	const port = await getAvailablePort();
	const pageProtocol = useHttps ? 'https' : 'http';
	const socketProtocol = useHttps ? 'wss' : 'ws';
	const vite = spawn(
		process.execPath,
		[
			'node_modules/vite/bin/vite.js',
			'--host',
			'127.0.0.1',
			'--port',
			String(port),
			'--strictPort',
		],
		{
			cwd: process.cwd(),
			env: {
				...process.env,
				...(useHttps ? { VITE_USE_HTTPS: 'true' } : {}),
				TEXLYRE_TYPESETTER_URL: typesetterUrl,
				TEXLYRE_TYPESETTER_PROXY_TOKEN: token,
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);
	let output = '';
	let errors = '';
	vite.stdout.setEncoding('utf8');
	vite.stderr.setEncoding('utf8');
	vite.stdout.on('data', (chunk) => {
		output += chunk;
	});
	vite.stderr.on('data', (chunk) => {
		errors += chunk;
	});

	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (output.includes(`${pageProtocol}://127.0.0.1:${port}`)) {
			return {
				vite,
				url: `${socketProtocol}://127.0.0.1:${port}/texlyre-typesetter`,
			};
		}
		if (vite.exitCode !== null) {
			throw new Error(`Vite proxy exited early: ${errors || output}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	vite.kill();
	await once(vite, 'exit');
	throw new Error(`Timed out waiting for Vite proxy: ${errors || output}`);
};

const stopProcess = async (process) => {
	if (!process || process.exitCode !== null || process.killed) return;
	process.kill();
	await once(process, 'exit');
};

const waitForEndpoint = async () => {
	let output = '';
	let errors = '';
	server.stdout.setEncoding('utf8');
	server.stderr.setEncoding('utf8');
	server.stdout.on('data', (chunk) => {
		output += chunk;
	});
	server.stderr.on('data', (chunk) => {
		errors += chunk;
	});

	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const match = output.match(/ws:\/\/127\.0\.0\.1:(\d+)/);
		if (match) return `ws://127.0.0.1:${match[1]}`;
		if (server.exitCode !== null) {
			throw new Error(`MiKTeX typesetter exited early: ${errors || output}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Timed out waiting for MiKTeX typesetter: ${errors || output}`);
};

const compile = (url, request) =>
	new Promise((resolve, reject) => {
		const socket = new WebSocket(
			url,
			url.startsWith('wss://') ? { rejectUnauthorized: false } : undefined,
		);
		const timeout = setTimeout(() => {
			socket.close();
			reject(new Error('Timed out waiting for MiKTeX compilation'));
		}, 90_000);

		socket.once('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		socket.once('open', () => socket.send(JSON.stringify(request)));
		socket.once('message', (message) => {
			clearTimeout(timeout);
			socket.close();
			resolve(JSON.parse(message.toString()));
		});
	});

let vite;
try {
	const endpoint = await waitForEndpoint();
	const info = await compile(endpoint, {
		type: 'info',
		requestId: 'remote-miktex-info',
		authToken: token,
	});
	assert.equal(info.type, 'info');
	assert.equal(info.status, 0);
	assert.equal(info.info?.distribution, 'MiKTeX');
	assert.match(info.info?.version ?? '', /MiKTeX\s+\d/i);

	const viteProxy = await startViteProxy(endpoint, true);
	vite = viteProxy.vite;
	const proxiedInfo = await compile(viteProxy.url, {
		type: 'info',
		requestId: 'same-origin-remote-miktex-info',
	});
	assert.equal(proxiedInfo.status, 0);
	assert.equal(proxiedInfo.info?.distribution, 'MiKTeX');

	const source = String.raw`\documentclass{article}
\begin{document}
Hello from remote MiKTeX.
\end{document}
`;

	const result = await compile(viteProxy.url, {
		requestId: 'real-remote-miktex-compile',
		mainFile: '/main.tex',
		format: 'pdf',
		options: { engine: 'pdflatex' },
		files: [
			{
				path: '/main.tex',
				content: Buffer.from(source).toString('base64'),
			},
		],
	});

	assert.equal(result.status, 0, result.log);
	assert.match(result.log, /latexmk|pdfTeX/i);
	assert.ok(result.output, 'The remote server did not return a PDF.');
	assert.ok(Buffer.from(result.output, 'base64').subarray(0, 4).equals(Buffer.from('%PDF')));
	assert.ok(
		result.artifacts?.some((artifact) => artifact.name.endsWith('.synctex.gz')),
		'The remote server did not return SyncTeX.',
	);

	const cleared = await compile(viteProxy.url, {
		requestId: 'clear-remote-cache',
		mainFile: '',
		format: '',
		files: [],
		options: { action: 'clear-cache' },
	});
	assert.equal(cleared.status, 0);
	assert.match(cleared.log, /no project cache to clear/i);

	const denied = await compile(endpoint, {
		requestId: 'unauthorized-compile',
		mainFile: '/main.tex',
		format: 'pdf',
		files: [],
	});
	assert.equal(denied.status, 1);
	assert.equal(denied.log, 'Unauthorized typesetter request.');

	console.log(
		'Remote MiKTeX E2E test passed through the HTTPS/WSS proxy: discovery, version, PDF, log, and SyncTeX returned.',
	);
} finally {
	await stopProcess(vite);
	await stopServer();
}
