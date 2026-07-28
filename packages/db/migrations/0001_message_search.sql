-- Cross channel search index. Messages themselves live in per channel storage
-- behind the MessageStore port, so this is a standalone FTS5 table rather than
-- an external content one. It is kept current by the inline indexer job.

CREATE VIRTUAL TABLE message_search USING fts5(
  message_id UNINDEXED,
  workspace_id UNINDEXED,
  channel_id UNINDEXED,
  author_id UNINDEXED,
  has_file UNINDEXED,
  created_at UNINDEXED,
  text,
  tokenize = 'unicode61 remove_diacritics 2'
);
