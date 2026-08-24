import { GoogleGenAI } from "@google/genai";
import {
  AiInvalidResponseError,
  AiProviderRateLimitError,
  AiServiceUnavailableError,
} from "../../errors/AppError.js";

/**
 * Thin wrapper around Google's `@google/genai` SDK.
 *
 * - The API key lives ONLY here, server-side. Never expose `GEMINI_API_KEY`
 *   to the client.
 * - Every failure mode (missing key, timeout, provider error, blocked/empty
 *   response) is mapped to a structured `AppError` so the global errorHandler
 *   can serialize a consistent, user-friendly response (503 / 502).
 * - Output is forced to JSON (`responseMimeType: "application/json"`) and the
 *   caller validates it with Zod before returning anything to the client.
 */

export interface AiCompletionOptions {
  /** Model tier — maps to a GEMINI_MODEL_* env override. Defaults to "lite". */
  model?: "lite" | "std" | "pro";
  /** System instruction prepended by the SDK's config. */
  system?: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface AiCompletionResult {
  text: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

const MODELS = {
  lite: process.env.GEMINI_MODEL_LITE ?? "gemini-2.5-flash-lite",
  std: process.env.GEMINI_MODEL_STD ?? "gemini-2.5-flash",
  pro: process.env.GEMINI_MODEL_PRO ?? "gemini-2.5-pro",
} as const;

const DEFAULT_MAX_OUTPUT_TOKENS = clampInt(
  process.env.GEMINI_MAX_OUTPUT_TOKENS,
  128,
  8192,
  1024,
);
const REQUEST_TIMEOUT_MS = clampInt(
  process.env.GEMINI_REQUEST_TIMEOUT_MS,
  1000,
  120_000,
  15_000,
);

const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;

/** Sleep for the given milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determines whether an error is transient and worth retrying.
 * - Provider 500/502/503 → yes (server outage, may recover)
 * - Network errors (ECONNRESET, socket hang up, etc.) → yes
 * - Timeout (AiServiceUnavailableError from withTimeout) → yes
 * - 429 rate limit → no (client handles via retryAfter)
 * - Empty/blocked response → no (won't resolve with retry)
 */
function isTransientError(error: unknown): boolean {
  // Rate limits and invalid responses are not transient — don't retry.
  if (error instanceof AiProviderRateLimitError) return false;
  if (error instanceof AiInvalidResponseError) return false;

  // Timeout errors come through as AiServiceUnavailableError.
  if (error instanceof AiServiceUnavailableError) return true;

  // Provider HTTP errors — check for 500/502/503 status codes.
  const record = error as Record<string, unknown>;
  const code = Number(record.code ?? record.statusCode ?? record.status);
  if (code >= 500 && code <= 503) return true;

  // Network / connection errors (ECONNRESET, ENOTFOUND, socket hang up, etc.).
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|network/i.test(message)) {
    return true;
  }

  return false;
}

/** Whether a Gemini API key is configured. Used to fail fast before prompting. */
export function isAiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Constructs a fresh client per call — the SDK client is a lightweight
 * config holder, and this keeps the module stateless and trivially testable.
 */
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AiServiceUnavailableError(
      "AI is not configured on this server. Please contact support.",
    );
  }
  return new GoogleGenAI({ apiKey });
}

function clampInt(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Rejects with an `AiServiceUnavailableError` if the promise doesn't settle in time. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new AiServiceUnavailableError(message)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface GeminiPart {
  text?: string;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
}

interface GeminiResponse {
  text?: string;
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

/**
 * Complete a prompt and return the raw text payload (JSON by contract).
 *
 * Retries transient provider failures (500/502/503, network errors, timeouts)
 * up to `MAX_RETRIES` times with exponential backoff. Does NOT retry rate
 * limits (429) or invalid/empty responses — those fail immediately.
 *
 * @throws {AiServiceUnavailableError} — not configured / timeout / provider failure
 * @throws {AiProviderRateLimitError} — provider-side 429 (no retry)
 * @throws {AiInvalidResponseError} — empty or safety-blocked response (no retry)
 */
export async function aiComplete(
  prompt: string,
  opts: AiCompletionOptions = {},
): Promise<AiCompletionResult> {
  const client = getClient();
  const model = MODELS[opts.model ?? "lite"];

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.warn(
        `[AiClient] Retrying Gemini request (attempt ${attempt + 1}/${MAX_RETRIES + 1}) after ${delay}ms`,
      );
      await sleep(delay);
    }

    let response: GeminiResponse;
    try {
      response = (await withTimeout(
        client.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            systemInstruction: opts.system,
            maxOutputTokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
            temperature: opts.temperature ?? 0.4,
            responseMimeType: "application/json",
          },
        }),
        REQUEST_TIMEOUT_MS,
        "The AI service took too long to respond. Please try again.",
      )) as GeminiResponse;
    } catch (error) {
      lastError = error;

      // Already-structured AppErrors — fail immediately, no retry.
      if (error instanceof AiProviderRateLimitError) throw error;
      if (error instanceof AiInvalidResponseError) throw error;

      // Google-side rate limiting / quota exhaustion (HTTP 429) — detect
      // before the retry decision so it surfaces as 429, not 503.
      if (isProviderRateLimit(error)) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[AiClient] Gemini rate limit / quota hit:", detail);
        throw new AiProviderRateLimitError(60, detail);
      }

      // Transient error — retry if attempts remain, otherwise throw.
      if (isTransientError(error)) {
        if (attempt < MAX_RETRIES) continue;
        console.error("[AiClient] Gemini request failed after retries:", error);
        throw new AiServiceUnavailableError(
          "The AI service is temporarily unavailable. Please try again.",
        );
      }

      // Unknown error — treat as non-transient, fail immediately.
      console.error("[AiClient] Gemini request failed:", error);
      throw new AiServiceUnavailableError(
        "The AI service is temporarily unavailable. Please try again.",
      );
    }

    // Success — extract and return.
    const text = extractText(response);
    return {
      text,
      model,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  // Should never reach here, but TypeScript requires it.
  throw lastError instanceof Error
    ? new AiServiceUnavailableError(lastError.message)
    : new AiServiceUnavailableError(
        "The AI service is temporarily unavailable. Please try again.",
      );
}

/**
 * Detects provider-side rate limiting / quota exhaustion (Google 429 with
 * RESOURCE_EXHAUSTED / RATE_LIMIT_EXCEEDED, or a matching message). These are
 * transient and recover within a minute, so they map to 429 — not the 503
 * reserved for genuine provider outages.
 */
function isProviderRateLimit(error: unknown): boolean {
  const record = error as Record<string, unknown>;
  const code = record.code ?? record.statusCode;
  const status = record.status;
  if (
    code === 429 ||
    code === "429" ||
    status === 429 ||
    status === "RESOURCE_EXHAUSTED" ||
    status === "RATE_LIMIT_EXCEEDED"
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /quota exceeded|rate limit|too many requests|resource_exhausted|"code"\s*:\s*429/i.test(
    message,
  );
}

function extractText(response: GeminiResponse): string {
  if (response.text) return response.text;

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((part) => part.text ?? "").join("").trim();
  if (!text) {
    throw new AiInvalidResponseError(
      "The AI response was empty or blocked by safety filters. Please rephrase and try again.",
    );
  }
  return text;
}
