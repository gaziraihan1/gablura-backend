import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════════
// Env must be set before the module under test evaluates its module-level consts.
// These writes persist in the shared test process (singleFork), so the originals
// are captured here and restored in afterAll to avoid leaking into later files.
// ═══════════════════════════════════════════════════════════════════════════════

vi.hoisted(() => {
  const prev: Record<string, string | undefined> = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_REQUEST_TIMEOUT_MS: process.env.GEMINI_REQUEST_TIMEOUT_MS,
    GEMINI_MAX_OUTPUT_TOKENS: process.env.GEMINI_MAX_OUTPUT_TOKENS,
  };
  (globalThis as any).__geminiEnvPrev = prev;
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_REQUEST_TIMEOUT_MS = "50";
  process.env.GEMINI_MAX_OUTPUT_TOKENS = "128";
});

afterAll(() => {
  const prev = (globalThis as any).__geminiEnvPrev as
    | Record<string, string | undefined>
    | undefined;
  delete (globalThis as any).__geminiEnvPrev;
  if (!prev) return;
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const mockGoogleGenAI = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  GoogleGenAI: mockGoogleGenAI,
}));

// ═══════════════════════════════════════════════════════════════════════════════

import { aiComplete, isAiConfigured } from "../../../lib/ai/gemini.client.js";
import {
  AiInvalidResponseError,
  AiProviderRateLimitError,
  AiServiceUnavailableError,
} from "../../../errors/AppError.js";

function mockGenerateContent(result: unknown) {
  const generateContent = vi.fn().mockResolvedValue(result);
  mockGoogleGenAI.mockImplementation(() => ({
    models: { generateContent },
  }));
  return generateContent;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = "test-key";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isAiConfigured", () => {
  it("returns true when an API key is present", () => {
    expect(isAiConfigured()).toBe(true);
  });

  it("returns false when the API key is missing", () => {
    delete process.env.GEMINI_API_KEY;
    expect(isAiConfigured()).toBe(false);
  });
});

describe("aiComplete", () => {
  it("returns text, model and usage on success", async () => {
    const generateContent = mockGenerateContent({
      text: '{"ok": true}',
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7 },
    });

    const result = await aiComplete("hello", { model: "std" });

    expect(result.text).toBe('{"ok": true}');
    expect(result.model).toBe(process.env.GEMINI_MODEL_STD ?? "gemini-2.5-flash");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.any(String),
        config: expect.objectContaining({
          responseMimeType: "application/json",
          maxOutputTokens: 128,
        }),
      }),
    );
  });

  it("falls back to candidates parts when response.text is absent", async () => {
    mockGenerateContent({
      candidates: [{ content: { parts: [{ text: "{" }, { text: '"a":1}' }] } }],
    });

    const result = await aiComplete("hello");
    expect(result.text).toBe('{"a":1}');
  });

  it("throws AI_INVALID_RESPONSE when the response is empty or blocked", async () => {
    mockGenerateContent({});

    await expect(aiComplete("hello")).rejects.toThrow(AiInvalidResponseError);
  });

  it("maps provider failures to AI_SERVICE_UNAVAILABLE", async () => {
    mockGoogleGenAI.mockImplementation(() => ({
      models: {
        generateContent: vi.fn().mockRejectedValue(new Error("500 from Google")),
      },
    }));

    await expect(aiComplete("hello")).rejects.toThrow(AiServiceUnavailableError);
  });

  it("maps provider 429 quota errors to AI_PROVIDER_RATE_LIMIT (not 503)", async () => {
    mockGoogleGenAI.mockImplementation(() => ({
      models: {
        generateContent: vi.fn().mockRejectedValue({
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "Quota exceeded for quota metric 'API requests' ...",
        }),
      },
    }));

    const err = await aiComplete("hello").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderRateLimitError);
    expect((err as AiProviderRateLimitError).statusCode).toBe(429);
    expect((err as AiProviderRateLimitError).code).toBe("AI_PROVIDER_RATE_LIMIT");
    expect((err as AiProviderRateLimitError).retryAfter).toBe(60);
  });

  it("detects provider rate limits embedded in the error message", async () => {
    mockGoogleGenAI.mockImplementation(() => ({
      models: {
        generateContent: vi
          .fn()
          .mockRejectedValue(
            new Error("429: Quota exceeded — Request limit per minute"),
          ),
      },
    }));

    await expect(aiComplete("hello")).rejects.toThrow(AiProviderRateLimitError);
  });

  it("throws AI_SERVICE_UNAVAILABLE on timeout", async () => {
    mockGoogleGenAI.mockImplementation(() => ({
      models: {
        generateContent: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    }));

    await expect(aiComplete("hello")).rejects.toThrow(AiServiceUnavailableError);
  });

  it("throws AI_SERVICE_UNAVAILABLE when no API key is configured", async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(aiComplete("hello")).rejects.toThrow(AiServiceUnavailableError);
  });
});
