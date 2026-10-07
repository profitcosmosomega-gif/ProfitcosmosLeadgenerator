CREATE TYPE "public"."ai_run_purpose" AS ENUM('turn', 'guardrail');--> statement-breakpoint
CREATE TYPE "public"."ai_run_status" AS ENUM('succeeded', 'failed', 'blocked', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."escalation_reason" AS ENUM('human_requested', 'cannot_confirm', 'sensitive_topic', 'possible_underage', 'abusive', 'guardrail_failure', 'limit_reached');--> statement-breakpoint
CREATE TYPE "public"."escalation_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."message_author" AS ENUM('lead', 'ai', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('received', 'sent', 'blocked');--> statement-breakpoint
ALTER TYPE "public"."actor_type" ADD VALUE 'ai';--> statement-breakpoint
ALTER TYPE "public"."data_source" ADD VALUE 'chat';--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"parent_run_id" uuid,
	"purpose" "ai_run_purpose" NOT NULL,
	"status" "ai_run_status" NOT NULL,
	"reason" text,
	"provider" text,
	"model" text,
	"prompt_id" text,
	"prompt_version" text,
	"stop_reason" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer,
	"latency_ms" integer,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_escalations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"reason" "escalation_reason" NOT NULL,
	"status" "escalation_status" DEFAULT 'open' NOT NULL,
	"message_id" uuid,
	"ai_run_id" uuid,
	"created_by_type" "actor_type" NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"channel" "channel_kind" NOT NULL,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"ai_paused" boolean DEFAULT false NOT NULL,
	"access_token_hash" text NOT NULL,
	"closed_reason" text,
	"processing_until" timestamp with time zone,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"author" "message_author" NOT NULL,
	"status" "message_status" NOT NULL,
	"body" text,
	"ai_run_id" uuid,
	"prompt_id" text,
	"prompt_version" text,
	"guardrail" jsonb,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_parent_run_id_ai_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_escalations" ADD CONSTRAINT "conversation_escalations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_escalations" ADD CONSTRAINT "conversation_escalations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_escalations" ADD CONSTRAINT "conversation_escalations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_escalations" ADD CONSTRAINT "conversation_escalations_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_escalations" ADD CONSTRAINT "conversation_escalations_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_escalations" ADD CONSTRAINT "conversation_escalations_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_organization_id_created_at_index" ON "ai_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_conversation_id_created_at_index" ON "ai_runs" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_lead_id_created_at_index" ON "ai_runs" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "conversation_escalations_organization_id_status_created_at_index" ON "conversation_escalations" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "conversation_escalations_conversation_id_index" ON "conversation_escalations" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_escalations_lead_id_index" ON "conversation_escalations" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_access_token_hash_index" ON "conversations" USING btree ("access_token_hash");--> statement-breakpoint
CREATE INDEX "conversations_organization_id_lead_id_index" ON "conversations" USING btree ("organization_id","lead_id");--> statement-breakpoint
CREATE INDEX "conversations_organization_id_last_message_at_index" ON "conversations" USING btree ("organization_id","last_message_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_created_at_index" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_unhandled_idx" ON "messages" USING btree ("conversation_id","created_at") WHERE "messages"."direction" = 'in' and "messages"."handled_at" is null;