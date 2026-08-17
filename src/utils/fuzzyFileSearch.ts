import type { FileNode } from '../types/files';

export interface FuzzyMatch {
	score: number;
	positions: number[];
}

export interface FuzzyFileSearchResult {
	file: FileNode;
	score: number;
	nameMatchPositions: number[];
	pathMatchPositions: number[];
}

const MATCH_SCORE = 10;
const ADJACENT_BONUS = 12;
const BOUNDARY_BONUS = 14;
const MAX_GAP_PENALTY = 8;

const normalizeQuery = (value: string): string =>
	Array.from(value.trim())
		.filter((character) => !/\s/.test(character))
		.join('')
		.replaceAll('\\', '/')
		.toLocaleLowerCase();

const isBoundary = (characters: string[], index: number): boolean => {
	if (index === 0) return true;

	const previous = characters[index - 1];
	const current = characters[index];
	return (
		'/\\_.- '.includes(previous) ||
		(current === current.toLocaleUpperCase() &&
			previous === previous.toLocaleLowerCase())
	);
};

/**
 * Matches a query as an ordered subsequence and rewards contiguous and
 * word-boundary matches. This gives short forms such as "fdt" useful matches
 * for paths like "figures/draft.tex", instead of requiring a prefix.
 */
export const findFuzzyMatch = (
	query: string,
	target: string,
): FuzzyMatch | null => {
	const normalizedQuery = normalizeQuery(query);
	if (!normalizedQuery) return { score: 0, positions: [] };

	const targetCharacters = Array.from(target);
	const queryCharacters = Array.from(normalizedQuery);
	if (queryCharacters.length > targetCharacters.length) return null;

	const targetLowercase = targetCharacters.map((character) =>
		character.toLocaleLowerCase(),
	);
	const scores: number[][] = [];
	const previousIndexes: number[][] = [];

	for (let queryIndex = 0; queryIndex < queryCharacters.length; queryIndex++) {
		const row = Array<number>(targetCharacters.length).fill(
			Number.NEGATIVE_INFINITY,
		);
		const previousRow = Array<number>(targetCharacters.length).fill(-1);

		for (
			let targetIndex = 0;
			targetIndex < targetCharacters.length;
			targetIndex++
		) {
			if (targetLowercase[targetIndex] !== queryCharacters[queryIndex]) {
				continue;
			}

			const characterScore =
				MATCH_SCORE +
				(isBoundary(targetCharacters, targetIndex) ? BOUNDARY_BONUS : 0) +
				(targetCharacters[targetIndex] === queryCharacters[queryIndex] ? 1 : 0);

			if (queryIndex === 0) {
				row[targetIndex] = characterScore - targetIndex * 0.15;
				continue;
			}

			for (
				let previousIndex = 0;
				previousIndex < targetIndex;
				previousIndex++
			) {
				const previousScore = scores[queryIndex - 1][previousIndex];
				if (!Number.isFinite(previousScore)) continue;

				const gap = targetIndex - previousIndex;
				const transitionScore =
					gap === 1 ? ADJACENT_BONUS : -Math.min(gap - 1, MAX_GAP_PENALTY);
				const score = previousScore + characterScore + transitionScore;

				if (score > row[targetIndex]) {
					row[targetIndex] = score;
					previousRow[targetIndex] = previousIndex;
				}
			}
		}

		scores.push(row);
		previousIndexes.push(previousRow);
	}

	const finalScores = scores.at(-1);
	if (!finalScores) return null;

	let finalIndex = -1;
	let finalScore = Number.NEGATIVE_INFINITY;
	for (let index = 0; index < finalScores.length; index++) {
		if (finalScores[index] > finalScore) {
			finalScore = finalScores[index];
			finalIndex = index;
		}
	}

	if (!Number.isFinite(finalScore) || finalIndex === -1) return null;

	const positions = Array<number>(queryCharacters.length);
	for (
		let queryIndex = queryCharacters.length - 1;
		queryIndex >= 0;
		queryIndex--
	) {
		positions[queryIndex] = finalIndex;
		finalIndex = previousIndexes[queryIndex][finalIndex];
	}

	return { score: finalScore, positions };
};

const scoreFile = (
	file: FileNode,
	query: string,
): FuzzyFileSearchResult | null => {
	const nameMatch = findFuzzyMatch(query, file.name);
	const pathMatch = findFuzzyMatch(query, file.path);
	const normalizedQuery = normalizeQuery(query);
	const pathQuery =
		normalizedQuery.includes('/') || normalizedQuery.includes('\\');

	if (!nameMatch && !pathMatch) return null;

	const exactName = file.name.toLocaleLowerCase() === normalizedQuery;
	const nameStartsWith = file.name
		.toLocaleLowerCase()
		.startsWith(normalizedQuery);
	const exactPath = file.path.toLocaleLowerCase() === normalizedQuery;
	const nameScore = nameMatch
		? nameMatch.score +
			(pathQuery ? 0 : 125) +
			(exactName ? 1_000 : 0) +
			(nameStartsWith ? 150 : 0)
		: Number.NEGATIVE_INFINITY;
	const pathScore = pathMatch
		? pathMatch.score + (pathQuery ? 250 : 0) + (exactPath ? 1_000 : 0)
		: Number.NEGATIVE_INFINITY;
	const useNameMatch = nameScore >= pathScore;

	return {
		file,
		score: Math.max(nameScore, pathScore),
		nameMatchPositions: useNameMatch ? (nameMatch?.positions ?? []) : [],
		pathMatchPositions: !useNameMatch ? (pathMatch?.positions ?? []) : [],
	};
};

export const fuzzyFileSearch = (
	files: FileNode[],
	query: string,
	limit = 50,
): FuzzyFileSearchResult[] => {
	const normalizedQuery = normalizeQuery(query);
	const fileNodes = files.filter((file) => file.type === 'file');

	if (!normalizedQuery) {
		return [...fileNodes]
			.sort((left, right) => left.path.localeCompare(right.path))
			.slice(0, limit)
			.map((file) => ({
				file,
				score: 0,
				nameMatchPositions: [],
				pathMatchPositions: [],
			}));
	}

	return fileNodes
		.map((file) => scoreFile(file, query))
		.filter((result): result is FuzzyFileSearchResult => result !== null)
		.sort(
			(left, right) =>
				right.score - left.score ||
				left.file.path.length - right.file.path.length ||
				left.file.path.localeCompare(right.file.path),
		)
		.slice(0, limit);
};
