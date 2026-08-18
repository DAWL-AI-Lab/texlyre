import {
	FileSystemBackupService,
} from '@/services/FileSystemBackupService';
import { Blob as NodeBlob } from 'node:buffer';

class MemoryFileHandle {
	readonly kind = 'file';
	content = new ArrayBuffer(0);

	async createWritable() {
		return {
			write: async (data: ArrayBuffer | Uint8Array) => {
				this.content = new Uint8Array(data).slice().buffer;
			},
			close: async () => {},
			abort: async () => {},
		};
	}
}

class MemoryDirectoryHandle {
	readonly kind = 'directory';
	readonly directories = new Map<string, MemoryDirectoryHandle>();
	readonly files = new Map<string, MemoryFileHandle>();

	async getDirectoryHandle(name: string, options?: { create?: boolean }) {
		const existing = this.directories.get(name);
		if (existing) return existing;
		if (!options?.create) throw new DOMException('Missing directory', 'NotFoundError');

		const directory = new MemoryDirectoryHandle();
		this.directories.set(name, directory);
		return directory;
	}

	async getFileHandle(name: string, options?: { create?: boolean }) {
		const existing = this.files.get(name);
		if (existing) return existing;
		if (!options?.create) throw new DOMException('Missing file', 'NotFoundError');

		const file = new MemoryFileHandle();
		this.files.set(name, file);
		return file;
	}

	async removeEntry(name: string) {
		this.files.delete(name);
		this.directories.delete(name);
	}

	async *entries(): AsyncIterableIterator<
		[string, MemoryFileHandle | MemoryDirectoryHandle]
	> {
		for (const entry of this.files) yield entry;
		for (const entry of this.directories) yield entry;
	}
}

describe('FileSystemBackupService backup history', () => {
	const originalBlob = global.Blob;

	beforeAll(() => {
		global.Blob = NodeBlob as any;
	});

	afterAll(() => {
		global.Blob = originalBlob;
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('creates ZIP snapshots in history and removes the oldest ones over the limit', async () => {
		const root = new MemoryDirectoryHandle();
		const service = new FileSystemBackupService();
		const privateService = service as any;

		privateService.rootHandle = root;
		service.setEnabled(true);
		service.setBackupHistoryOptions(true, 2);
		privateService.prepareExportData = jest.fn(async () => ({
			manifest: { version: '1.0.0', lastSync: Date.now(), mode: 'backup' },
			account: null,
			projects: [],
			projectData: new Map(),
		}));
		jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

		await service.exportToFileSystem();
		await service.exportToFileSystem();
		await service.exportToFileSystem();

		expect(service.getStatus().error).toBeUndefined();
		const history = root.directories.get('history')!;
		const archiveNames = [...history.files.keys()].sort();
		expect(archiveNames).toEqual([
			'backup-1700000000001.zip',
			'backup-1700000000002.zip',
		]);
		expect(root.directories.has('projects')).toBe(false);

		const archive = history.files.get(archiveNames[0])!;
		expect([...new Uint8Array(archive.content).slice(0, 4)]).toEqual([
			0x50,
			0x4b,
			0x03,
			0x04,
		]);
	});
});
