import type { AiMessage, AiProvider } from '@huddle/domain';

/**
 * AI is off unless a key is configured, so a default install never pays for it
 * and never sends message content anywhere.
 */
export const disabledAi: AiProvider = {
  available: false,
  async complete() {
    throw new Error('AI is not configured on this instance');
  },
  async embed() {
    throw new Error('AI is not configured on this instance');
  },
};

interface WorkersAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

/**
 * Workers AI is the zero configuration option: it needs no key and has a free
 * daily allowance. Installs that want better output configure Claude instead.
 */
export class WorkersAiProvider implements AiProvider {
  readonly available = true;

  constructor(
    private readonly ai: WorkersAiBinding,
    private readonly textModel = '@cf/meta/llama-3.1-8b-instruct',
    private readonly embedModel = '@cf/baai/bge-base-en-v1.5',
  ) {}

  async complete(input: { messages: AiMessage[]; maxTokens: number }): Promise<string> {
    const result = (await this.ai.run(this.textModel, {
      messages: input.messages,
      max_tokens: input.maxTokens,
    })) as { response?: string };
    return result.response ?? '';
  }

  async embed(texts: string[]): Promise<number[][]> {
    const result = (await this.ai.run(this.embedModel, { text: texts })) as {
      data?: number[][];
    };
    return result.data ?? [];
  }
}
