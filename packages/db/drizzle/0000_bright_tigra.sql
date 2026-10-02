CREATE TYPE "public"."actor_type" AS ENUM('user', 'system', 'agent');--> statement-breakpoint
CREATE TYPE "public"."asset_type" AS ENUM('cover', 'manuscript', 'epub', 'preview', 'other');--> statement-breakpoint
CREATE TYPE "public"."book_status" AS ENUM('DRAFT', 'RESEARCHING', 'RESEARCH_READY', 'PLANNING', 'PLAN_READY', 'WRITING', 'EDITING', 'PRODUCTION', 'QA', 'READY_FOR_REVIEW', 'USER_APPROVED', 'PUBLISHING', 'SUBMITTED', 'LIVE', 'FAILED', 'NEEDS_REVISION', 'BLOCKED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."fact_check_result" AS ENUM('verified', 'needs_revision', 'unsupported', 'conflicting');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRYING', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('research', 'planning', 'writing', 'editorial', 'fact_check', 'consistency', 'qa', 'preflight', 'cover', 'metadata', 'epub', 'publishing');--> statement-breakpoint
CREATE TYPE "public"."provenance_method" AS ENUM('user_created', 'ai_assisted', 'ai_generated');--> statement-breakpoint
CREATE TYPE "public"."publishing_mode" AS ENUM('prepare', 'assisted', 'automated');--> statement-breakpoint
CREATE TYPE "public"."quality_issue_status" AS ENUM('open', 'accepted', 'rejected', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."quality_severity" AS ENUM('critical', 'warning', 'suggestion');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_job_id" uuid NOT NULL,
	"agent_type" text NOT NULL,
	"provider" text,
	"model" text,
	"input_units" integer,
	"output_units" integer,
	"estimated_cost" text,
	"duration_ms" integer,
	"status" text NOT NULL,
	"error_details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_project_id" uuid NOT NULL,
	"manuscript_id" uuid NOT NULL,
	"metadata_id" uuid NOT NULL,
	"cover_asset_id" uuid NOT NULL,
	"epub_asset_id" uuid NOT NULL,
	"provenance_fingerprint" text NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"book_project_id" uuid,
	"actor_type" "actor_type" NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_project_id" uuid NOT NULL,
	"asset_type" "asset_type" NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"provenance_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text,
	"subtitle" text,
	"description" text,
	"author_names" jsonb,
	"publisher_name" text,
	"keywords" jsonb,
	"categories" jsonb,
	"language" text,
	"audience" jsonb,
	"rights" text,
	"price" text,
	"ai_disclosure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text,
	"subtitle" text,
	"positioning" text,
	"book_promise" text,
	"target_word_count" integer,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"outline" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"status" "book_status" DEFAULT 'DRAFT' NOT NULL,
	"working_title" text,
	"topic" text,
	"target_reader" text,
	"genre" text,
	"desired_length" integer,
	"tone_style" text,
	"author_name" text,
	"publisher_name" text,
	"current_research_project_id" uuid,
	"current_plan_id" uuid,
	"current_manuscript_id" uuid,
	"current_metadata_id" uuid,
	"current_cover_asset_id" uuid,
	"current_epub_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"language" text,
	"primary_marketplace" text,
	"rights_choice" text,
	"price" text,
	"currency" text,
	"kdp_select_preference" boolean,
	"drm_preference" text,
	"ai_disclosure" text DEFAULT 'ai_assisted',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "book_state_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_project_id" uuid NOT NULL,
	"from_state" "book_status" NOT NULL,
	"to_state" "book_status" NOT NULL,
	"event" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"reason" text,
	"job_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapter_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"generation_source" text,
	"provenance_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_project_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text,
	"objective" text,
	"target_word_count" integer,
	"current_draft_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_project_id" uuid NOT NULL,
	"chapter_id" uuid,
	"review_type" text NOT NULL,
	"status" text DEFAULT 'COMPLETE' NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fact_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_project_id" uuid NOT NULL,
	"chapter_id" uuid,
	"claim" text NOT NULL,
	"source_id" uuid,
	"result" "fact_check_result" NOT NULL,
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"book_project_id" uuid NOT NULL,
	"job_type" "job_type" NOT NULL,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error_code" text,
	"error_message" text,
	"progress" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "manuscripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"assembled_content" jsonb NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ASSEMBLED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preflight_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_project_id" uuid NOT NULL,
	"passed" boolean NOT NULL,
	"checks" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provenance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"method" "provenance_method" NOT NULL,
	"provider" text,
	"model" text,
	"agent_run_id" uuid,
	"source_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_credentials" text,
	"status" text DEFAULT 'unverified' NOT NULL,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publishing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publishing_job_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publishing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_project_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"mode" "publishing_mode" DEFAULT 'prepare' NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"external_reference" text,
	"package_storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_project_id" uuid NOT NULL,
	"chapter_id" uuid,
	"severity" "quality_severity" NOT NULL,
	"issue_type" text NOT NULL,
	"message" text NOT NULL,
	"location" text,
	"proposed_fix" text,
	"status" "quality_issue_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"research_project_id" uuid NOT NULL,
	"source_id" uuid,
	"finding_type" text,
	"statement" text NOT NULL,
	"confidence" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_project_id" uuid NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"research_brief" text,
	"market_summary" text,
	"reader_problem_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "research_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"research_project_id" uuid NOT NULL,
	"url" text,
	"title" text,
	"source_name" text,
	"published_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_type" text,
	"status" text,
	"extracted_content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"auth_provider_id" text,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_book_project_id_book_projects_id_fk" FOREIGN KEY ("book_project_id") REFERENCES "public"."book_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_manuscript_id_manuscripts_id_fk" FOREIGN KEY ("manuscript_id") REFERENCES "public"."manuscripts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_metadata_id_book_metadata_id_fk" FOREIGN KEY ("metadata_id") REFERENCES "public"."book_metadata"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_cover_asset_id_book_assets_id_fk" FOREIGN KEY ("cover_asset_id") REFERENCES "public"."book_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_epub_asset_id_book_assets_id_fk" FOREIGN KEY ("epub_asset_id") REFERENCES "public"."book_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_book_project_id_book_projects_id_fk" FOREIGN KEY ("book_project_id") REFERENCES "public"."book_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_assets" ADD CONSTRAINT "book_assets_book_project_id_book_projects_id_fk" FOREIGN KEY ("book_project_id") REFERENCES "public"."book_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_assets" ADD CONSTRAINT "book_assets_provenance_id_provenance_records_id_fk" FOREIGN KEY ("provenance_id") REFERENCES "public"."provenance_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD CONSTRAINT "book_metadata_book_project_id_book_projects_id_fk" FOREIGN KEY ("book_project_id") REFERENCES "public"."book_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_plans" ADD CONSTRAINT "book_plans_book_project_id_book_projects_id_fk" FOREIGN KEY ("book_project_id") REFERENCES "public"."book_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_projects" ADD CONSTRAINT "book_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_settings" ADD CONSTRAINT "book_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_state_transitions" ADD CONSTRAINT "book_state_transitions_book_project_id_book_projects_id_fk" FOREIGN KEY ("book_project_id") REFERENCES "public"."book_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_state_transitions" ADD CONSTRAINT "book_state_transitions_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_drafts" ADD CONSTRAINT "chapter_drafts_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_drafts" ADD CONSTRAINT "chapter_drafts_provenance_id_provenance_records_id_fk" FOREIGN KEY ("provenance_id") REFERENCES "public"."provenance_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_book_project_id_book_projects_id_fk" FOREIGN KEY ("book_project_id") REFERENCES "public"."book_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_reviews" ADD CONSTRAINT "editorial_reviews_book_project_id_book_projects_id_fk" FOREIGN KEY ("book_project_id") REFERENCES "public"."book_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_reviews" ADD CONSTRAINT "editorial_reviews_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_checks" ADD CONSTRAINT "fact_checks_book_project_id_book_projects_id_fk" FOREIGN KEY ("book_project_id") REFERENCES "public"."book_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_checks" ADD CONSTRAINT "fact_checks_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fact_checks" ADD CONSTRAINT "fact_checks_source_id_research_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."research_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_book_project_id_book_projects_id_fk" FOREIGN KEY ("book_project_id") REFERENCES "public"."book_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manuscripts" ADD CONSTRAINT "manuscripts_book_project_id_book_projects_id_fk" FOREIGN KEY ("book_project_id") REFERENCES "public"."book_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preflight_runs" ADD CONSTRAINT "preflight_runs_book_project_id_book_projects_id_fk" FOREIGN KEY ("book_project_id") REFERENCES "public"."book_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_records" ADD CONSTRAINT "provenance_records_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_records" ADD CONSTRAINT "provenance_records_source_asset_id_book_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."book_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_events" ADD CONSTRAINT "publishing_events_publishing_job_id_publishing_jobs_id_fk" FOREIGN KEY ("publishing_job_id") REFERENCES "public"."publishing_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_book_project_id_book_projects_id_fk" FOREIGN KEY ("book_project_id") REFERENCES "public"."book_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_issues" ADD CONSTRAINT "quality_issues_book_project_id_book_projects_id_fk" FOREIGN KEY ("book_project_id") REFERENCES "public"."book_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_issues" ADD CONSTRAINT "quality_issues_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_research_project_id_research_projects_id_fk" FOREIGN KEY ("research_project_id") REFERENCES "public"."research_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_source_id_research_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."research_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_projects" ADD CONSTRAINT "research_projects_book_project_id_book_projects_id_fk" FOREIGN KEY ("book_project_id") REFERENCES "public"."book_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_research_project_id_research_projects_id_fk" FOREIGN KEY ("research_project_id") REFERENCES "public"."research_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_runs_job_idx" ON "agent_runs" USING btree ("generation_job_id");--> statement-breakpoint
CREATE INDEX "approval_events_book_idx" ON "approval_events" USING btree ("book_project_id");--> statement-breakpoint
CREATE INDEX "audit_events_book_idx" ON "audit_events" USING btree ("book_project_id");--> statement-breakpoint
CREATE INDEX "book_assets_book_idx" ON "book_assets" USING btree ("book_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "book_assets_book_type_version_idx" ON "book_assets" USING btree ("book_project_id","asset_type","version");--> statement-breakpoint
CREATE INDEX "book_metadata_book_idx" ON "book_metadata" USING btree ("book_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "book_metadata_book_version_idx" ON "book_metadata" USING btree ("book_project_id","version");--> statement-breakpoint
CREATE INDEX "book_plans_book_idx" ON "book_plans" USING btree ("book_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "book_plans_book_version_idx" ON "book_plans" USING btree ("book_project_id","version");--> statement-breakpoint
CREATE INDEX "book_projects_user_id_idx" ON "book_projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "book_state_transitions_book_idx" ON "book_state_transitions" USING btree ("book_project_id");--> statement-breakpoint
CREATE INDEX "book_state_transitions_job_idx" ON "book_state_transitions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "chapter_drafts_chapter_idx" ON "chapter_drafts" USING btree ("chapter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_drafts_chapter_version_idx" ON "chapter_drafts" USING btree ("chapter_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_book_ordinal_idx" ON "chapters" USING btree ("book_project_id","ordinal");--> statement-breakpoint
CREATE INDEX "chapters_book_idx" ON "chapters" USING btree ("book_project_id");--> statement-breakpoint
CREATE INDEX "editorial_reviews_book_idx" ON "editorial_reviews" USING btree ("book_project_id");--> statement-breakpoint
CREATE INDEX "fact_checks_book_idx" ON "fact_checks" USING btree ("book_project_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_book_idx" ON "generation_jobs" USING btree ("book_project_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_status_idx" ON "generation_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "manuscripts_book_idx" ON "manuscripts" USING btree ("book_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manuscripts_book_version_idx" ON "manuscripts" USING btree ("book_project_id","version");--> statement-breakpoint
CREATE INDEX "preflight_runs_book_idx" ON "preflight_runs" USING btree ("book_project_id");--> statement-breakpoint
CREATE INDEX "provenance_records_agent_run_idx" ON "provenance_records" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "provider_accounts_user_idx" ON "provider_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_accounts_user_provider_idx" ON "provider_accounts" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "publishing_events_job_idx" ON "publishing_events" USING btree ("publishing_job_id");--> statement-breakpoint
CREATE INDEX "publishing_jobs_book_idx" ON "publishing_jobs" USING btree ("book_project_id");--> statement-breakpoint
CREATE INDEX "quality_issues_book_idx" ON "quality_issues" USING btree ("book_project_id");--> statement-breakpoint
CREATE INDEX "quality_issues_book_status_idx" ON "quality_issues" USING btree ("book_project_id","status");--> statement-breakpoint
CREATE INDEX "research_findings_project_idx" ON "research_findings" USING btree ("research_project_id");--> statement-breakpoint
CREATE INDEX "research_projects_book_idx" ON "research_projects" USING btree ("book_project_id");--> statement-breakpoint
CREATE INDEX "research_sources_project_idx" ON "research_sources" USING btree ("research_project_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");