import type { FileNode } from '@src/types/files';
import { findFuzzyMatch, fuzzyFileSearch } from '@src/utils/fuzzyFileSearch';

const createFile = (name: string, path: string): FileNode => ({
	id: path,
	name,
	path,
	type: 'file',
	lastModified: 0,
});

describe('fuzzyFileSearch', () => {
	it('matches ordered, non-prefix characters and records their positions', () => {
		const match = findFuzzyMatch('fdt', 'figures/draft.tex');

		expect(match).not.toBeNull();
		expect(match?.positions).toEqual([0, 8, 14]);
	});

	it('ranks a filename match ahead of a less-direct path match', () => {
		const results = fuzzyFileSearch(
			[
				createFile('chapter-notes.tex', '/archive/chapter-notes.tex'),
				createFile('notes.tex', '/chapter-notes/notes.tex'),
			],
			'chapter',
		);

		expect(results.map((result) => result.file.name)).toEqual([
			'chapter-notes.tex',
			'notes.tex',
		]);
	});

	it('uses path matching for directory queries and ignores directories', () => {
		const directory: FileNode = {
			id: '/chapters',
			name: 'chapters',
			path: '/chapters',
			type: 'directory',
			lastModified: 0,
		};
		const result = fuzzyFileSearch(
			[directory, createFile('intro.tex', '/chapters/intro.tex')],
			'chap/int',
		);

		expect(result).toHaveLength(1);
		expect(result[0].file.path).toBe('/chapters/intro.tex');
		expect(result[0].pathMatchPositions).not.toHaveLength(0);
	});

	it('accepts either path separator in a directory query', () => {
		const result = fuzzyFileSearch(
			[createFile('intro.tex', '/chapters/intro.tex')],
			'chap\\int',
		);

		expect(result.map((match) => match.file.path)).toEqual([
			'/chapters/intro.tex',
		]);
	});
});
