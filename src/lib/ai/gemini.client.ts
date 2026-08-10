import { GoogleGenAI } from "@google/genai";
import {
  AiInvalidResponseError,
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
 * @throws {AiServiceUnavailableError} — not configured / timeout / provider failure
 * @throws {AiInvalidResponseError} — empty or safety-blocked response
 */
export async function aiComplete(
  prompt: string,
  opts: AiCompletionOptions = {},
): Promise<AiCompletionResult> {
  const client = getClient();
  const model = MODELS[opts.model ?? "lite"];

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
    if (error instanceof AiServiceUnavailableError) throw error;
    console.error("[AiClient] Gemini request failed:", error);
    throw new AiServiceUnavailableError(
      "The AI service is temporarily unavailable. Please try again.",
    );
  }

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
