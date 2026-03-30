CREATE TYPE "llm_session_status" AS ENUM('disconnected', 'idle', 'thinking', 'permanent-error', 'ratelimited');--> statement-breakpoint
CREATE TYPE "llm_source" AS ENUM('user', 'system-default');--> statement-breakpoint
CREATE TYPE "stagehand_browser_session_status" AS ENUM('running', 'terminated');--> statement-breakpoint
CREATE TYPE "stagehand_step_operation" AS ENUM('act', 'extract', 'observe', 'agent');--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"llm_session_id" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"prompt" text NOT NULL,
	"expected_response_schema" jsonb,
	"response" jsonb,
	"error" jsonb,
	"usage" jsonb,
	"model" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"source" "llm_source" DEFAULT 'user'::"llm_source" NOT NULL,
	"display_name" text,
	"model_name" text NOT NULL,
	"base_url" text,
	"system_prompt" text,
	"provider_options" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"copied_template_id" uuid,
	"forked_session_id" uuid,
	"project_id" uuid NOT NULL,
	"browser_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"last_request_at" timestamp with time zone,
	"last_response_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_message" text,
	"status" "llm_session_status" NOT NULL,
	"model" text NOT NULL,
	"base_url" text,
	"options" jsonb,
	"extra_http_headers" jsonb,
	"system_prompt" text,
	"tokens_input" integer DEFAULT 0 NOT NULL,
	"tokens_output" integer DEFAULT 0 NOT NULL,
	"tokens_reasoning" integer DEFAULT 0 NOT NULL,
	"tokens_cached_input" integer DEFAULT 0 NOT NULL,
	"tokens_total" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stagehand_browser_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"browserbase_session_id" uuid,
	"cdp_url" text NOT NULL,
	"status" "stagehand_browser_session_status" NOT NULL,
	"default_llm_session_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stagehand_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"stagehand_browser_session_id" uuid NOT NULL,
	"operation" "stagehand_step_operation" NOT NULL,
	"llm_template_id" uuid NOT NULL,
	"llm_session_id" uuid,
	"params" jsonb NOT NULL,
	"result" jsonb
);
--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_llm_session_id_llm_sessions_id_fkey" FOREIGN KEY ("llm_session_id") REFERENCES "llm_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "llm_sessions" ADD CONSTRAINT "llm_sessions_copied_template_id_fkey" FOREIGN KEY ("copied_template_id") REFERENCES "llm_sessions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "llm_sessions" ADD CONSTRAINT "llm_sessions_forked_session_id_fkey" FOREIGN KEY ("forked_session_id") REFERENCES "llm_sessions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "stagehand_browser_sessions" ADD CONSTRAINT "stagehand_browser_sessions_s0BMZHuHZkxx_fkey" FOREIGN KEY ("default_llm_session_id") REFERENCES "llm_sessions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "stagehand_steps" ADD CONSTRAINT "stagehand_steps_kqGcAyNQHgqC_fkey" FOREIGN KEY ("stagehand_browser_session_id") REFERENCES "stagehand_browser_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "stagehand_steps" ADD CONSTRAINT "stagehand_steps_llm_template_id_llm_sessions_id_fkey" FOREIGN KEY ("llm_template_id") REFERENCES "llm_sessions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "stagehand_steps" ADD CONSTRAINT "stagehand_steps_llm_session_id_llm_sessions_id_fkey" FOREIGN KEY ("llm_session_id") REFERENCES "llm_sessions"("id") ON DELETE SET NULL;