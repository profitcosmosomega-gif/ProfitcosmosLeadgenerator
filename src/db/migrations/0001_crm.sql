CREATE TYPE "public"."actor_type" AS ENUM('user', 'system', 'lead');--> statement-breakpoint
CREATE TYPE "public"."channel_kind" AS ENUM('web', 'email', 'whatsapp', 'instagram', 'messenger', 'sms', 'tiktok');--> statement-breakpoint
CREATE TYPE "public"."consent_channel" AS ENUM('email', 'sms', 'whatsapp', 'phone');--> statement-breakpoint
CREATE TYPE "public"."consent_purpose" AS ENUM('transactional', 'marketing');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('granted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."data_source" AS ENUM('form', 'import', 'staff');--> statement-breakpoint
CREATE TYPE "public"."desired_start" AS ENUM('unknown', 'now', '30d', '90d', 'later');--> statement-breakpoint
CREATE TYPE "public"."experience_level" AS ENUM('unknown', 'beginner', 'intermediate', 'experienced');--> statement-breakpoint
CREATE TYPE "public"."mentorship_interest" AS ENUM('unknown', 'yes', 'maybe', 'no');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage" AS ENUM('NEW_LEAD', 'ENGAGED', 'QUALIFYING', 'QUALIFIED', 'CONSULTATION_BOOKED', 'CONSULTATION_COMPLETED', 'ENROLLMENT_PENDING', 'ENROLLED', 'NURTURE', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."suppression_kind" AS ENUM('email', 'phone');--> statement-breakpoint
CREATE TABLE "channel_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"channel" "channel_kind" NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"channel" "consent_channel" NOT NULL,
	"purpose" "consent_purpose" NOT NULL,
	"status" "consent_status" NOT NULL,
	"source" "data_source" NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"file_name" text,
	"counts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_qualification" (
	"lead_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"experience_level" "experience_level" DEFAULT 'unknown' NOT NULL,
	"markets_of_interest" text[] DEFAULT '{}'::text[] NOT NULL,
	"main_difficulties" text[] DEFAULT '{}'::text[] NOT NULL,
	"goals" text[] DEFAULT '{}'::text[] NOT NULL,
	"reason_for_training" text,
	"previous_training" text,
	"desired_start" "desired_start" DEFAULT 'unknown' NOT NULL,
	"mentorship_interest" "mentorship_interest" DEFAULT 'unknown' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"full_name" text,
	"email" text,
	"phone" text,
	"country" text,
	"timezone" text,
	"locale" text,
	"age_confirmed18plus" boolean,
	"stage" "pipeline_stage" DEFAULT 'NEW_LEAD' NOT NULL,
	"outcome_reason" text,
	"owner_user_id" uuid,
	"source" text,
	"first_touch_id" uuid,
	"last_touch_id" uuid,
	"merged_into_lead_id" uuid,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_stage" "pipeline_stage",
	"to_stage" "pipeline_stage" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "suppression_kind" NOT NULL,
	"value_hash" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "touchpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" "data_source" NOT NULL,
	"source" text,
	"medium" text,
	"campaign" text,
	"content" text,
	"term" text,
	"landing_page" text,
	"referrer" text,
	"click_ids" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_imports" ADD CONSTRAINT "lead_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_imports" ADD CONSTRAINT "lead_imports_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_qualification" ADD CONSTRAINT "lead_qualification_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_qualification" ADD CONSTRAINT "lead_qualification_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_first_touch_id_touchpoints_id_fk" FOREIGN KEY ("first_touch_id") REFERENCES "public"."touchpoints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_last_touch_id_touchpoints_id_fk" FOREIGN KEY ("last_touch_id") REFERENCES "public"."touchpoints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_merged_into_lead_id_leads_id_fk" FOREIGN KEY ("merged_into_lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression_list" ADD CONSTRAINT "suppression_list_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_identities_organization_id_channel_external_id_index" ON "channel_identities" USING btree ("organization_id","channel","external_id");--> statement-breakpoint
CREATE INDEX "channel_identities_lead_id_index" ON "channel_identities" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "consents_lead_id_channel_purpose_created_at_index" ON "consents" USING btree ("lead_id","channel","purpose","created_at");--> statement-breakpoint
CREATE INDEX "lead_events_lead_id_occurred_at_index" ON "lead_events" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "lead_events_organization_id_occurred_at_index" ON "lead_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "lead_imports_organization_id_created_at_index" ON "lead_imports" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_notes_lead_id_created_at_index" ON "lead_notes" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_org_email_active_unique" ON "leads" USING btree ("organization_id","email") WHERE "leads"."email" is not null and "leads"."erased_at" is null and "leads"."merged_into_lead_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_org_phone_active_unique" ON "leads" USING btree ("organization_id","phone") WHERE "leads"."phone" is not null and "leads"."erased_at" is null and "leads"."merged_into_lead_id" is null;--> statement-breakpoint
CREATE INDEX "leads_organization_id_stage_index" ON "leads" USING btree ("organization_id","stage");--> statement-breakpoint
CREATE INDEX "leads_organization_id_created_at_index" ON "leads" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_organization_id_owner_user_id_index" ON "leads" USING btree ("organization_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "stage_transitions_lead_id_created_at_index" ON "stage_transitions" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppression_list_organization_id_kind_value_hash_index" ON "suppression_list" USING btree ("organization_id","kind","value_hash");--> statement-breakpoint
CREATE INDEX "touchpoints_lead_id_occurred_at_index" ON "touchpoints" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "touchpoints_organization_id_source_index" ON "touchpoints" USING btree ("organization_id","source");