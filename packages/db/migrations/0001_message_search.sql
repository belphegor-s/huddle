-- Full text search over message text. An expression index rather than a stored
-- tsvector column, because the query uses the identical expression and a
-- generated column would double the storage of every message body.
CREATE INDEX IF NOT EXISTS messages_text_search_idx ON messages USING GIN (to_tsvector('simple', text));
--> statement-breakpoint
-- The history and unread queries always narrow by channel first.
CREATE INDEX IF NOT EXISTS messages_channel_created_idx ON messages (channel_id, created_at DESC);
