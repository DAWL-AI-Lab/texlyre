import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { t } from '@/i18n';
import { useFileTree } from '../../hooks/useFileTree';
import {
	fuzzyFileSearch,
	type FuzzyFileSearchResult,
} from '../../utils/fuzzyFileSearch';
import { FileIcon } from '../common/Icons';

interface QuickOpenProps {
	onFileSelect: (fileId: string) => void | Promise<void>;
}

const MAX_RESULTS = 50;

const flattenFiles = (nodes: ReturnType<typeof useFileTree>['fileTree']) =>
	nodes.flatMap((node) => [
		node,
		...(node.children ? flattenFiles(node.children) : []),
	]);

const HighlightedText: React.FC<{
	text: string;
	positions: number[];
}> = ({ text, positions }) => {
	const matchingPositions = new Set(positions);
	const parts: Array<{ start: number; text: string; isMatch: boolean }> = [];

	for (const [index, character] of Array.from(text).entries()) {
		const isMatch = matchingPositions.has(index);
		const previousPart = parts.at(-1);
		if (previousPart?.isMatch === isMatch) {
			previousPart.text += character;
		} else {
			parts.push({ start: index, text: character, isMatch });
		}
	}

	return (
		<>
			{parts.map((part) =>
				part.isMatch ? (
					<mark key={part.start}>{part.text}</mark>
				) : (
					<span key={part.start}>{part.text}</span>
				),
			)}
		</>
	);
};

const QuickOpen: React.FC<QuickOpenProps> = ({ onFileSelect }) => {
	const { fileTree } = useFileTree();
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	const files = useMemo(() => flattenFiles(fileTree), [fileTree]);
	const results = useMemo(
		() => fuzzyFileSearch(files, query, MAX_RESULTS),
		[files, query],
	);

	const close = () => {
		setIsOpen(false);
		setQuery('');
		setSelectedIndex(0);
	};

	const selectResult = async (result?: FuzzyFileSearchResult) => {
		if (!result) return;
		close();
		await onFileSelect(result.file.id);
	};

	useEffect(() => {
		const handleOpenQuickOpen = () => {
			setQuery('');
			setSelectedIndex(0);
			setIsOpen(true);
		};

		document.addEventListener('open-file-quick-open', handleOpenQuickOpen);
		return () =>
			document.removeEventListener('open-file-quick-open', handleOpenQuickOpen);
	}, []);

	useEffect(() => {
		if (!isOpen) return;

		const focusInput = window.requestAnimationFrame(() =>
			inputRef.current?.focus(),
		);
		return () => window.cancelAnimationFrame(focusInput);
	}, [isOpen]);

	useEffect(() => {
		setSelectedIndex((index) =>
			Math.min(index, Math.max(results.length - 1, 0)),
		);
	}, [results.length]);

	useEffect(() => {
		if (!isOpen) return;
		document
			.querySelector<HTMLElement>('[data-quick-open-active="true"]')
			?.scrollIntoView?.({ block: 'nearest' });
	}, [isOpen, selectedIndex]);

	if (!isOpen) return null;

	const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
			return;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			setSelectedIndex((index) => Math.min(index + 1, results.length - 1));
			return;
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			setSelectedIndex((index) => Math.max(index - 1, 0));
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			void selectResult(results[selectedIndex]);
		}
	};

	return (
		<div
			className='quick-open-overlay'
			role='presentation'
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) close();
			}}
		>
			<div
				className='quick-open'
				role='dialog'
				aria-modal='true'
				aria-label={t('Quick Open')}
			>
				<label className='visually-hidden' htmlFor='quick-open-input'>
					{t('Search files')}
				</label>
				<input
					id='quick-open-input'
					ref={inputRef}
					className='quick-open-input'
					type='text'
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setSelectedIndex(0);
					}}
					onKeyDown={handleKeyDown}
					placeholder={t('Search files by name or path')}
					autoComplete='off'
					spellCheck={false}
				/>

				<div className='quick-open-results' role='listbox'>
					{results.length === 0 ? (
						<div className='quick-open-empty'>{t('No matching files')}</div>
					) : (
						results.map((result, index) => {
							const directoryEnd = result.file.path.lastIndexOf('/');
							const directory =
								directoryEnd > 0
									? result.file.path.slice(0, directoryEnd)
									: '/';
							const directoryMatchPositions = result.pathMatchPositions.filter(
								(position) => position < directoryEnd,
							);
							const isSelected = index === selectedIndex;

							return (
								<button
									className={`quick-open-result${isSelected ? ' selected' : ''}`}
									data-quick-open-active={isSelected || undefined}
									key={result.file.id}
									type='button'
									role='option'
									aria-selected={isSelected}
									onMouseMove={() => setSelectedIndex(index)}
									onClick={() => void selectResult(result)}
								>
									<FileIcon />
									<span className='quick-open-result-name'>
										<HighlightedText
											text={result.file.name}
											positions={result.nameMatchPositions}
										/>
									</span>
									<span className='quick-open-result-path'>
										<HighlightedText
											text={directory}
											positions={directoryMatchPositions}
										/>
									</span>
								</button>
							);
						})
					)}
				</div>
				<div className='quick-open-hint'>
					<span>
						<kbd>↑</kbd> <kbd>↓</kbd> {t('to navigate')}
					</span>
					<span>
						<kbd>Enter</kbd> {t('to open')}
					</span>
					<span>
						<kbd>Esc</kbd> {t('to close')}
					</span>
				</div>
			</div>
		</div>
	);
};

export default QuickOpen;
