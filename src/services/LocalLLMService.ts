const REQUEST_TIMEOUT_MS = 120_000;

export type LocalLLMProvider = "vllm" | "ollama";

const PROVIDER_PREFIXES: Record<LocalLLMProvider, string> = {
	vllm: "/vllm/v1",
	ollama: "/ollama/api",
};

export interface LocalLLMModel {
	id: string;
}

interface ChatCompletionResponse {
	choices?: Array<{ message?: { content?: string } }>;
}

const rewriteSchema = {
	type: "object",
	properties: {
		replacement: {
			type: "string",
		},
	},
	required: ["replacement"],
	additionalProperties: false,
};

async function fetchFromLocalLLM(provider: LocalLLMProvider, path: string, options?: RequestInit): Promise<Response> {
	const controller = new AbortController();
	const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		return await fetch(`${PROVIDER_PREFIXES[provider]}${path}`, {
			...options,
			signal: controller.signal,
		});
	} catch (error) {
		if (controller.signal.aborted) {
			throw new Error("The language model request timed out. Please try again.");
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

export async function getLocalLLMModels(provider: LocalLLMProvider): Promise<LocalLLMModel[]> {
	const response = await fetchFromLocalLLM(provider, provider === "vllm" ? "/models" : "/tags");
	if (!response.ok) {
		throw new Error(`Could not load models (${response.status})`);
	}

	if (provider === "ollama") {
		const payload = (await response.json()) as {
			models?: Array<{ name?: string; model?: string }>;
		};
		return (payload.models ?? [])
			.map((model) => ({ id: model.name || model.model || "" }))
			.filter((model) => Boolean(model.id));
	}

	const payload = (await response.json()) as { data?: LocalLLMModel[] };
	return (payload.data ?? []).filter((model) => Boolean(model.id));
}

export async function requestLocalLLMRewrite(
	provider: LocalLLMProvider,
	model: string,
	prompt: string,
): Promise<string> {
	const messages = [
		{
			role: "system",
			content: `
You are a precise text rewriting assistant.

TASK
Rewrite the provided text according to the user's instruction.

RULES
- Preserve the original meaning unless explicitly asked to change it.
- Preserve important names, numbers, URLs, and technical terms.
- Do not explain your changes.
- Do not include markdown or code fences.
- Return valid JSON only.
- Return exactly one JSON property named "replacement".
- "replacement" must be a string.

OUTPUT SCHEMA
{
  "replacement": "string"
}
`.trim(),
		},
		{ role: "user", content: prompt },
	];
	const response = await fetchFromLocalLLM(provider, provider === "vllm" ? "/chat/completions" : "/chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model,
			...(provider === "vllm"
				? { temperature: 0.2, max_tokens: 2048 }
				: {
						stream: false,
						format: rewriteSchema,
						think: false,
						options: { temperature: 0.2 },
					}),
			messages,
		}),
	});

	if (!response.ok) {
		const detail = await response.text();
		throw new Error(
			detail
				? `The language model returned ${response.status}: ${detail}`
				: `The language model returned ${response.status}`,
		);
	}

	const payload = (await response.json()) as ChatCompletionResponse & {
		message?: { content?: string; thinking?: string };
	};
	const content = (
		provider === "ollama"
			? payload.message?.content || payload.message?.thinking
			: payload.choices?.[0]?.message?.content
	)?.trim();
	if (!content) throw new Error("The language model returned no suggestion.");

	const json = content
		.replace(/^```json\s*/i, "")
		.replace(/^```\s*/i, "")
		.replace(/\s*```$/, "");
	try {
		const parsed = JSON.parse(json) as { replacement?: unknown };
		if (typeof parsed.replacement !== "string") {
			throw new Error("The response did not contain a replacement string.");
		}
		return parsed.replacement;
	} catch (error) {
		if (error instanceof Error && error.message.includes("replacement")) {
			throw error;
		}
		throw new Error("The language model returned an invalid structured response.");
	}
}
