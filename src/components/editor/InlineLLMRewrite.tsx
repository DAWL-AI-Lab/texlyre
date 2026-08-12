import type { EditorView } from "codemirror";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { t } from "@/i18n";
import {
	setInlineLLMSuggestion,
	setInlineLLMTarget,
	type InlineLLMSuggestion,
} from "../../extensions/codemirror/InlineLLMSuggestionExtension";
import {
	getLocalLLMModels,
	requestLocalLLMRewrite,
	type LocalLLMModel,
	type LocalLLMProvider,
} from "../../services/LocalLLMService";
import { CloseIcon, EditIcon } from "../common/Icons";

interface SelectionRange {
	from: number;
	to: number;
}

interface InlineLLMRewriteProps {
	viewRef: React.RefObject<EditorView | null>;
	disabled?: boolean;
}

interface Position {
	left: number;
	top: number;
}

const segmentSentences = (text: string): Array<{ from: number; to: number }> => {
	if ("Segmenter" in Intl) {
		const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
		return Array.from(segmenter.segment(text), ({ index, segment }) => ({
			from: index,
			to: index + segment.length,
		}));
	}

	const sentences: Array<{ from: number; to: number }> = [];
	const expression = /[^.!?\n]+(?:[.!?]+|$)/g;
	for (const match of text.matchAll(expression)) {
		const from = match.index ?? 0;
		sentences.push({ from, to: from + match[0].length });
	}
	return sentences;
};

const createRewritePrompt = (documentText: string, selection: SelectionRange, request: string) => {
	const overlapping = segmentSentences(documentText).filter(
		(sentence) => sentence.to > selection.from && sentence.from < selection.to,
	);
	const contextFrom = overlapping[0]?.from ?? selection.from;
	const contextTo = overlapping.at(-1)?.to ?? selection.to;
	const context = documentText.slice(contextFrom, contextTo);
	const selectedFrom = selection.from - contextFrom;
	const selectedTo = selection.to - contextFrom;
	const markedContext =
		context.slice(0, selectedFrom) +
		"[[HIGHLIGHT_START]]" +
		context.slice(selectedFrom, selectedTo) +
		"[[HIGHLIGHT_END]]" +
		context.slice(selectedTo);

	return `Rewrite only the text between [[HIGHLIGHT_START]] and [[HIGHLIGHT_END]]. Preserve the surrounding context, LaTeX commands, citations, labels, and the document's language unless the request explicitly asks to change them. Do not include the highlight markers in the replacement. Return JSON only, with this exact shape: {"replacement":"..."}.

USER REQUEST:
${request}

SENTENCE CONTEXT (the highlighted region is marked):
${markedContext}`;
};

const InlineLLMRewrite: React.FC<InlineLLMRewriteProps> = ({ viewRef, disabled = false }) => {
	const [selection, setSelection] = useState<SelectionRange | null>(null);
	const [position, setPosition] = useState<Position | null>(null);
	const [models, setModels] = useState<LocalLLMModel[]>([]);
	const [provider, setProvider] = useState<LocalLLMProvider>("vllm");
	const [model, setModel] = useState("");
	const [request, setRequest] = useState("");
	const [isExpanded, setIsExpanded] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const promptInputRef = useRef<HTMLInputElement>(null);

	const close = useCallback(() => {
		viewRef.current?.dispatch({ effects: setInlineLLMTarget.of(null) });
		setSelection(null);
		setPosition(null);
		setIsExpanded(false);
		setRequest("");
		setError(null);
	}, []);

	const positionForSelection = useCallback(
		(range: SelectionRange, panelHeight: number) => {
			const view = viewRef.current;
			if (!view) return null;
			const coords = view.coordsAtPos(range.to);
			if (!coords) return null;
			const showAbove = coords.bottom + panelHeight > window.innerHeight;
			return {
				left: Math.max(8, Math.min(coords.left, window.innerWidth - 440)),
				top: showAbove ? Math.max(8, coords.top - panelHeight) : coords.bottom + 8,
			};
		},
		[viewRef],
	);

	const updateForSelection = useCallback(() => {
		if (disabled || isLoading) return;
		const view = viewRef.current;
		const range = view?.state.selection.main;
		if (!view || !range || range.from === range.to) {
			close();
			return;
		}

		const nextSelection = { from: range.from, to: range.to };
		const nextPosition = positionForSelection(nextSelection, 44);
		if (!nextPosition) return;
		setSelection(nextSelection);
		setPosition(nextPosition);
		setIsExpanded(false);
		setError(null);
	}, [close, disabled, isLoading, positionForSelection, viewRef]);

	useEffect(() => {
		if (disabled) return;
		const onMouseUp = () => window.setTimeout(updateForSelection, 0);
		const onKeyUp = () => window.setTimeout(updateForSelection, 0);
		let editor: HTMLElement | null = null;
		const attach = () => {
			if (editor || !viewRef.current?.dom) return;
			editor = viewRef.current.dom;
			editor.addEventListener("mouseup", onMouseUp);
			editor.addEventListener("keyup", onKeyUp);
		};

		attach();
		const waitForEditor = editor ? undefined : window.setInterval(attach, 100);
		return () => {
			if (waitForEditor) clearInterval(waitForEditor);
			editor?.removeEventListener("mouseup", onMouseUp);
			editor?.removeEventListener("keyup", onKeyUp);
		};
	}, [disabled, updateForSelection, viewRef]);

	useEffect(() => {
		if (!selection || models.length > 0) return;
		let cancelled = false;
		getLocalLLMModels(provider)
			.then((availableModels) => {
				if (cancelled) return;
				setModels(availableModels);
				setModel((current) => current || availableModels[0]?.id || "");
			})
			.catch((loadError: unknown) => {
				if (!cancelled) {
					setError(loadError instanceof Error ? loadError.message : t("Could not connect to the language model."));
				}
			});
		return () => {
			cancelled = true;
		};
	}, [models.length, provider, selection]);

	useEffect(() => {
		if (selection && isExpanded) promptInputRef.current?.focus();
	}, [selection, isExpanded]);

	const expand = () => {
		const view = viewRef.current;
		if (!selection || !view) return;
		view.dispatch({
			selection: { anchor: selection.from, head: selection.to },
			effects: setInlineLLMTarget.of(selection),
		});
		setPosition(positionForSelection(selection, 220));
		setIsExpanded(true);
	};

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		const view = viewRef.current;
		if (!view || !selection || !request.trim() || !model) return;

		setIsLoading(true);
		setError(null);
		try {
			const text = view.state.doc.toString();
			const nextSuggestion = await requestLocalLLMRewrite(
				provider,
				model,
				createRewritePrompt(text, selection, request.trim()),
			);
			const original = view.state.doc.sliceString(selection.from, selection.to);
			const suggestion: InlineLLMSuggestion = {
				id: crypto.randomUUID(),
				from: selection.from,
				to: selection.to,
				original,
				replacement: nextSuggestion,
				onAccept: (current) => {
					view.dispatch({
						changes: {
							from: current.from,
							to: current.to,
							insert: current.replacement,
						},
						selection: { anchor: current.from + current.replacement.length },
						effects: setInlineLLMSuggestion.of(null),
					});
					view.focus();
				},
				onReject: () => view.dispatch({ effects: setInlineLLMSuggestion.of(null) }),
			};
			view.dispatch({
				effects: [setInlineLLMSuggestion.of(suggestion), setInlineLLMTarget.of(null)],
			});
			close();
		} catch (requestError) {
			setError(requestError instanceof Error ? requestError.message : t("The language model request failed."));
		} finally {
			setIsLoading(false);
		}
	};

	if (!selection || !position) return null;
	if (!isExpanded) {
		return (
			<button
				type="button"
				className="inline-llm-rewrite-trigger"
				style={{ left: position.left, top: position.top }}
				onMouseDown={(event) => event.preventDefault()}
				onClick={expand}
				title={t("Rewrite selected text")}
				aria-label={t("Rewrite selected text")}
			>
				<EditIcon />
			</button>
		);
	}

	return (
		<div
			className="inline-llm-rewrite"
			style={{ left: position.left, top: position.top }}
			role="dialog"
			aria-label={t("Rewrite selected text")}
			onMouseDown={(event) => event.stopPropagation()}
		>
			<div className="inline-llm-rewrite-header">
				<span>
					<EditIcon /> {t("Rewrite selection")}
				</span>
				<button type="button" onClick={close} title={t("Close")}>
					<CloseIcon />
				</button>
			</div>

			<form onSubmit={submit}>
				<input
					ref={promptInputRef}
					value={request}
					onChange={(event) => setRequest(event.target.value)}
					placeholder={t("Describe the change you want")}
					disabled={isLoading || models.length === 0}
				/>
				<div className="inline-llm-rewrite-controls">
					<select
						value={provider}
						onChange={(event) => {
							setProvider(event.target.value as LocalLLMProvider);
							setModels([]);
							setModel("");
							setError(null);
						}}
						disabled={isLoading}
						aria-label={t("Language model provider")}
					>
						<option value="vllm">vLLM (SSH)</option>
						<option value="ollama">Ollama (local)</option>
					</select>
					<select
						value={model}
						onChange={(event) => setModel(event.target.value)}
						disabled={isLoading || models.length === 0}
						aria-label={t("Language model")}
					>
						{models.map((availableModel) => (
							<option key={availableModel.id} value={availableModel.id}>
								{availableModel.id}
							</option>
						))}
					</select>
					<button type="submit" disabled={isLoading || !request.trim() || !model}>
						{isLoading ? t("Writing...") : t("Suggest")}
					</button>
				</div>
			</form>
			{error && <p className="inline-llm-rewrite-error">{error}</p>}
		</div>
	);
};

export default InlineLLMRewrite;
