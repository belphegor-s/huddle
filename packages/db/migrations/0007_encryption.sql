CREATE TABLE "channel_keys" (
	"channel_id" text NOT NULL,
	"epoch" integer NOT NULL,
	"device_id" text NOT NULL,
	"sealed" text NOT NULL,
	"sealed_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "channel_keys_channel_id_epoch_device_id_pk" PRIMARY KEY("channel_id","epoch","device_id")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"encryption_key" text NOT NULL,
	"signing_key" text NOT NULL,
	"label" text,
	"created_at" bigint NOT NULL,
	"last_seen_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "encrypted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "key_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "epoch" integer;--> statement-breakpoint
ALTER TABLE "channel_keys" ADD CONSTRAINT "channel_keys_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_keys" ADD CONSTRAINT "channel_keys_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_keys" ADD CONSTRAINT "channel_keys_sealed_by_devices_id_fk" FOREIGN KEY ("sealed_by") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_keys_device_idx" ON "channel_keys" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");