export interface SearchHit {
  messageId: string;
  channelId: string;
  authorId: string;
  /** Server rendered snippet with match markers, never raw HTML. */
  snippet: string;
  createdAt: number;
  score: number;
}

export interface SearchQuery {
  workspaceId: string;
  text: string;
  /** Channels the asking user may read. Filtering happens here, not after. */
  channelIds: string[];
  authorId?: string;
  hasFile?: boolean;
  after?: number;
  before?: number;
  limit: number;
}

export interface SearchIndex {
  index(input: {
    messageId: string;
    workspaceId: string;
    channelId: string;
    authorId: string;
    text: string;
    hasFile: boolean;
    createdAt: number;
  }): Promise<void>;

  remove(messageId: string): Promise<void>;

  query(input: SearchQuery): Promise<SearchHit[]>;
}
