import { StateEffect, StateField } from '@codemirror/state';
import {
	Decoration,
	EditorView,
	WidgetType,
	type DecorationSet,
} from '@codemirror/view';

export interface InlineLLMSuggestion {
	id: string;
	from: number;
	to: number;
	original: string;
	replacement: string;
	onAccept: (suggestion: InlineLLMSuggestion) => void;
	onReject: () => void;
}

export interface InlineLLMTarget {
	from: number;
	to: number;
}

interface InlineLLMSuggestionState {
	suggestion: InlineLLMSuggestion | null;
	target: InlineLLMTarget | null;
	decorations: DecorationSet;
}

export const setInlineLLMSuggestion = StateEffect.define<
	InlineLLMSuggestion | null
>();
export const setInlineLLMTarget = StateEffect.define<InlineLLMTarget | null>();

class InlineLLMSuggestionWidget extends WidgetType {
	constructor(readonly suggestion: InlineLLMSuggestion) {
		super();
	}

	eq(other: InlineLLMSuggestionWidget): boolean {
		return (
			this.suggestion.id === other.suggestion.id &&
			this.suggestion.original === other.suggestion.original &&
			this.suggestion.replacement === other.suggestion.replacement
		);
	}

	toDOM(): HTMLElement {
		const container = document.createElement('span');
		container.className = 'cm-inline-llm-suggestion';
		container.dataset.llmSuggestionId = this.suggestion.id;

		const replacement = document.createElement('ins');
		replacement.textContent = this.suggestion.replacement;
		container.append(replacement);

		const actions = document.createElement('span');
		actions.className = 'cm-inline-llm-suggestion-actions';
		const reject = document.createElement('button');
		reject.type = 'button';
		reject.className = 'secondary';
		reject.textContent = 'Reject';
		reject.addEventListener('mousedown', (event) => event.preventDefault());
		reject.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.suggestion.onReject();
		});
		actions.append(reject);

		const accept = document.createElement('button');
		accept.type = 'button';
		accept.textContent = 'Accept';
		accept.addEventListener('mousedown', (event) => event.preventDefault());
		accept.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.suggestion.onAccept(this.suggestion);
		});
		actions.append(accept);
		container.append(actions);

		return container;
	}

	ignoreEvent() {
		return false;
	}
}

function decorationsFor(
	suggestion: InlineLLMSuggestion | null,
	target: InlineLLMTarget | null,
): DecorationSet {
	const decorations = [];
	if (target) {
		decorations.push(
			Decoration.mark({ class: 'cm-inline-llm-target' }).range(
				target.from,
				target.to,
			),
		);
	}
	if (suggestion) {
		decorations.push(
			Decoration.mark({ class: 'cm-inline-llm-original' }).range(
				suggestion.from,
				suggestion.to,
			),
			Decoration.widget({
				widget: new InlineLLMSuggestionWidget(suggestion),
				side: 1,
			}).range(suggestion.to),
		);
	}
	return Decoration.set(decorations, true);
}

export const inlineLLMSuggestionExtension = StateField.define<
	InlineLLMSuggestionState | null
>({
	create() {
		return null;
	},

	update(value, transaction) {
		let suggestion = value?.suggestion ?? null;
		let target = value?.target ?? null;
		for (const effect of transaction.effects) {
			if (effect.is(setInlineLLMSuggestion)) suggestion = effect.value;
			if (effect.is(setInlineLLMTarget)) target = effect.value;
		}

		if (transaction.docChanged) {
			if (suggestion) {
				suggestion = {
					...suggestion,
					from: transaction.changes.mapPos(suggestion.from, 1),
					to: transaction.changes.mapPos(suggestion.to, -1),
				};
			}
			if (target) {
				target = {
					from: transaction.changes.mapPos(target.from, 1),
					to: transaction.changes.mapPos(target.to, -1),
				};
			}
		}

		if (!suggestion && !target) return null;
		return { suggestion, target, decorations: decorationsFor(suggestion, target) };
	},

	provide: (field) =>
		EditorView.decorations.from(
			field,
			(value) => value?.decorations ?? Decoration.none,
		),
});
