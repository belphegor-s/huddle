-- Invitations made before this stored only a hash of their token. The link
-- they represent cannot be recovered from that hash and cannot be matched
-- against one any more either, so they are rows that could only ever fail.
-- They go, rather than being left to look live.
DELETE FROM "invites";
--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "token" text NOT NULL;
