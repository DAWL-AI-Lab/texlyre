import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';

const port = Number.parseInt(process.env.TEXLYRE_TYPESETTER_PORT ?? '7021', 10);
const host = '127.0.0.1';

function toBase64(bytes) {
	return Buffer.from(bytes).toString('base64');
}

function safeRelativePath(input) {
	const normalized = path.posix.normalize(String(input).replaceAll('\\', '/'));
	const relative = normalized.replace(/^\/+/, '');
	if (
		!relative ||
		relative === '.' ||
		relative.startsWith('../') ||
		/^[A-Za-z]:/.test(relative) ||
		relative.includes('\0')
	) {
		throw new Error(`Unsafe project path: ${input}`);
	}
	return relative;
}

function run(command, args, cwd) {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			cwd,
			windowsHide: true,
			env: { ...process.env },
		});
		let log = '';
		child.stdout.on('data', (chunk) => {
			log += chunk;
		});
		child.stderr.on('data', (chunk) => {
			log += chunk;
		});
		child.on('error', (error) => {
			log += `\nFailed to launch ${command}: ${error.message}\n`;
			resolve({ status: 1, log });
		});
		child.on('close', (code) => resolve({ status: code ?? 1, log }));
	});
}

async function handleCompile(request) {
	const requestId = typeof request.requestId === 'string' ? request.requestId : '';
	const format = typeof request.format === 'string' ? request.format : 'pdf';
	const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'texlyre-latex-'));

	try {
		if (!Array.isArray(request.files) || request.files.length === 0) {
			throw new Error('The compile request contains no project files.');
		}

		for (const file of request.files) {
			const relativePath = safeRelativePath(file.path);
			if (typeof file.content !== 'string') {
				throw new Error(`Missing content for ${relativePath}`);
			}
			const destination = path.join(workspace, ...relativePath.split('/'));
			if (!destination.startsWith(workspace + path.sep)) {
				throw new Error(`Unsafe project path: ${file.path}`);
			}
			await fs.mkdir(path.dirname(destination), { recursive: true });
			await fs.writeFile(destination, Buffer.from(file.content, 'base64'));
		}

		const mainFile = safeRelativePath(request.mainFile);
		const mainPath = path.join(workspace, ...mainFile.split('/'));
		try {
			await fs.access(mainPath);
		} catch {
			throw new Error(`Main file was not supplied: ${mainFile}`);
		}

		const outputDirectory = 'build';
		const result = await run(
			'latexmk',
			[
				'-halt-on-error',
				'-file-line-error',
				'-interaction=nonstopmode',
				'-synctex=1',
				'-lualatex',
				`-outdir=${outputDirectory}`,
				mainFile,
			],
			workspace,
		);

		const basename = path.posix.basename(mainFile).replace(/\.[^.]+$/, '');
		const pdfPath = path.join(workspace, outputDirectory, `${basename}.pdf`);
		const synctexPath = path.join(
			workspace,
			outputDirectory,
			`${basename}.synctex.gz`,
		);
		const output = result.status === 0 ? await fs.readFile(pdfPath) : undefined;
		const artifacts = [];
		try {
			artifacts.push({
				id: `${requestId}-synctex`,
				name: `${basename}.synctex.gz`,
				mimeType: 'application/gzip',
				data: toBase64(await fs.readFile(synctexPath)),
			});
		} catch {
			// A failed compile may not produce SyncTeX; its absence is reflected in the log.
		}

		return {
			requestId,
			status: result.status,
			log: result.log,
			format,
			mimeType: 'application/pdf',
			...(output ? { output: toBase64(output) } : {}),
			...(artifacts.length ? { artifacts } : {}),
		};
	} catch (error) {
		return {
			requestId,
			status: 1,
			log: error instanceof Error ? error.message : String(error),
			format,
		};
	} finally {
		await fs.rm(workspace, { recursive: true, force: true });
	}
}

const wss = new WebSocketServer({ host, port, maxPayload: 512 * 1024 * 1024 });
wss.on('connection', (socket) => {
	socket.on('message', async (payload) => {
		let request;
		try {
			request = JSON.parse(payload.toString());
		} catch {
			socket.send(JSON.stringify({ requestId: '', status: 1, log: 'Invalid JSON request.', format: 'pdf' }));
			return;
		}
		socket.send(JSON.stringify(await handleCompile(request)));
	});
});

console.log(`Texlyre local LaTeX typesetter listening at ws://${host}:${port}`);
