import type { Config } from '../config.js';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiClient {
  readonly available: boolean;
  complete(input: { messages: AiMessage[]; maxTokens: number }): Promise<string>;
}

/**
 * Any OpenAI compatible endpoint: OpenAI itself, a local Ollama, vLLM, or a
 * gateway in front of Claude. Off unless a base URL is configured, so a
 * default install never sends message content anywhere.
 */
export class OpenAiCompatibleClient implements AiClient {
  readonly available = true;

  constructor(private readonly config: Config['ai']) {}

  async complete(input: { messages: AiMessage[]; maxTokens: number }): Promise<string> {
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.config.apiKey === '' ? {} : { authorization: `Bearer ${this.config.apiKey}` }),
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: input.messages,
        max_tokens: input.maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI request failed with ${response.status}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return body.choices?.[0]?.message?.content ?? '';
  }
}

export const disabledAi: AiClient = {
  available: false,
  async complete() {
    throw new Error('AI is not configured on this instance');
  },
};

export function createAiClient(config: Config['ai']): AiClient {
  return config.baseUrl === '' ? disabledAi : new OpenAiCompatibleClient(config);
}
