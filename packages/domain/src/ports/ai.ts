export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Optional everywhere. A default install has no key and no AI, so it never
 * adds cost. Self hosters can point this at their own provider.
 */
export interface AiProvider {
  readonly available: boolean;
  complete(input: { messages: AiMessage[]; maxTokens: number }): Promise<string>;
  embed(texts: string[]): Promise<number[][]>;
}
