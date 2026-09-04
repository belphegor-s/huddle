DROP INDEX "invites_token_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_idx" ON "invites" USING btree ("token");--> statement-breakpoint
ALTER TABLE "invites" DROP COLUMN "token_hash";