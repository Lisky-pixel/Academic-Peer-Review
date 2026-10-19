import { z } from "zod";

/**
 * Validated server environment.
 *
 * Parsed once at module load so a misconfigured deployment fails immediately
 * and loudly, rather than at 2am when someone uploads the first file.
 *
 * Server-only: this module reads secrets and must never reach the browser.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/env.ts was imported in the browser. It contains secrets — server only.");
}

const DEV_SESSION_SECRET_PREFIX = "dev-only";

const booleanish = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1");

/**
 * A value pasted into a hosting dashboard often keeps the quotes it had in a
 * .env file, and those quotes are then sent as part of it: an EMAIL_FROM of
 * "Name <a@b.com>" with the quotes is rejected by Resend. Strip them.
 */
const unquoted = z
  .string()
  .trim()
  .transform((value) => value.replace(/^(["'])(.*)\1$/, "$2").trim());

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // Without a trailing slash, so links are built as `${APP_URL}/path`.
    APP_URL: unquoted.pipe(z.url()).transform((value) => value.replace(/\/+$/, "")),
    APP_NAME: z.string().min(1).default("Academic Peer Review"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    // 32 bytes of base64 is 44 characters; anything shorter is not a real key.
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

    STORAGE_ENDPOINT: z.url(),
    STORAGE_REGION: z.string().default("auto"),
    STORAGE_BUCKET: z.string().min(1),
    STORAGE_ACCESS_KEY_ID: z.string().min(1),
    STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
    STORAGE_FORCE_PATH_STYLE: booleanish.default(false),
    STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(20 * 1024 * 1024),

    EMAIL_PROVIDER: z.enum(["smtp", "resend"]).default("smtp"),
    EMAIL_FROM: unquoted.pipe(z.string().min(1)),
    EMAIL_REPLY_TO: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_SECURE: booleanish.default(false),
    RESEND_API_KEY: unquoted.optional(),

    CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 characters"),
  })
  .superRefine((env, ctx) => {
    // Each provider needs its own credentials. Checking here, rather than at
    // send time, means a bad config never reaches a user-visible failure.
    if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: 'RESEND_API_KEY is required when EMAIL_PROVIDER is "resend"',
      });
    }
    if (env.EMAIL_PROVIDER === "smtp" && !env.SMTP_HOST) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_HOST"],
        message: 'SMTP_HOST is required when EMAIL_PROVIDER is "smtp"',
      });
    }

    if (env.NODE_ENV === "production") {
      // The .env.example placeholders are convenient in dev and catastrophic in
      // production — a known session secret means anyone can forge a session.
      if (env.SESSION_SECRET.startsWith(DEV_SESSION_SECRET_PREFIX)) {
        ctx.addIssue({
          code: "custom",
          path: ["SESSION_SECRET"],
          message: "SESSION_SECRET is still the development placeholder. Generate a real one.",
        });
      }
      if (env.CRON_SECRET.startsWith(DEV_SESSION_SECRET_PREFIX)) {
        ctx.addIssue({
          code: "custom",
          path: ["CRON_SECRET"],
          message: "CRON_SECRET is still the development placeholder. Generate a real one.",
        });
      }
      if (env.APP_URL.startsWith("http://")) {
        ctx.addIssue({
          code: "custom",
          path: ["APP_URL"],
          message: "APP_URL must use https in production — session cookies are Secure-only.",
        });
      }
      if (env.EMAIL_PROVIDER !== "resend") {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_PROVIDER"],
          message: "Production must use the resend provider, not a local SMTP catcher.",
        });
      }
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `Invalid environment configuration:\n${details}\n\n` +
      `Compare your .env.local against .env.example.`,
  );
}

export const env = Object.freeze(parsed.data);

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";
