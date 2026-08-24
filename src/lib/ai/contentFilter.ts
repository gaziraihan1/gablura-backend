/**
 * Lightweight content moderation filter.
 *
 * Catches obviously harmful user input *before* it reaches the LLM. This is
 * a first line of defence — not a replacement for a dedicated content
 * moderation API. Patterns are intentionally broad; edge cases should be
 * escalated to a human-review pipeline, not silently blocked.
 *
 * The filter is applied to every user-supplied string that flows into a
 * prompt (titles, goals, messages, notes, etc.) inside `runFeature`.
 */

/**
 * Patterns that indicate the input should be blocked. Each entry is a
 * `(RegExp, reason)` tuple. The regex is tested case-insensitively against
 * the full input string.
 *
 * Categories:
 * - Prompt-injection overrides ("ignore instructions", "system prompt", etc.)
 * - Hate speech / slurs
 * - Extreme violence / self-harm
 * - Malicious code / exploits
 */
const BLOCK_PATTERNS: [RegExp, string][] = [
  // ── Prompt-injection overrides ──────────────────────────────────────────
  [
    /ignore\s+(all\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|rules?|guidelines?|prompts?|directives?|constraints?)/i,
    "PROMPT_INJECTION",
  ],
  [
    /you\s+are\s+now\s+(a|an|the)\s+/i,
    "PROMPT_INJECTION",
  ],
  [
    /disregard\s+(all\s+)?(your\s+)?(instructions?|rules?|guidelines?|prompts?)/i,
    "PROMPT_INJECTION",
  ],
  [
    /(?:new|override|replace)\s+system\s+(?:prompt|instruction)/i,
    "PROMPT_INJECTION",
  ],
  [
    /(?:act|behave|respond)\s+as\s+(?:if|though)\s+you\s+(?:have|had)\s+no\s+(?:restrictions?|rules?|guidelines?)/i,
    "PROMPT_INJECTION",
  ],
  [
    /\bDAN\b.*\b(?:mode|prompt|jailbreak)\b/i,
    "PROMPT_INJECTION",
  ],

  // ── Hate speech / slurs (common slurs — not exhaustive) ────────────────
  [
    /\b(?:n[i1]gg[ae3]r|f[ae]g{1,2}[o0]t|k[i1]ke|sp[i1]c|ch[i1]nk|wetback|towelhead|raghead)\b/i,
    "HATE_SPEECH",
  ],

  // ── Extreme violence / self-harm ────────────────────────────────────────
  [
    /\b(?:how\s+to\s+(?:kill|murder|assassinate|poison)\s+(?:someone|a\s+person|my\s+(?:boss|teacher|neighbor|colleague)))\b/i,
    "VIOLENCE",
  ],
  [
    /\b(?:best\s+way\s+to\s+(?:commit\s+)?suicide|suicide\s+(?:method|technique|methods?))\b/i,
    "SELF_HARM",
  ],

  // ── Malicious code / exploits ───────────────────────────────────────────
  [
    /<script[\s>]|javascript:|onerror\s*=|onload\s*=|eval\s*\(|document\.cookie/i,
    "MALICIOUS_CODE",
  ],
  [
    /DROP\s+TABLE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|SELECT\s+\*\s+FROM/i,
    "MALICIOUS_CODE",
  ],
];

export interface ContentFilterResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Checks user-supplied text against the block patterns.
 * Returns `{ allowed: true }` when the input is safe, or
 * `{ allowed: false, reason }` when it should be rejected.
 */
export function checkContent(text: string): ContentFilterResult {
  if (!text || text.trim().length === 0) {
    return { allowed: true };
  }

  for (const [pattern, reason] of BLOCK_PATTERNS) {
    if (pattern.test(text)) {
      return { allowed: false, reason };
    }
  }

  return { allowed: true };
}

/**
 * Convenience wrapper that throws a `ValidationError` when content is blocked.
 * Import from the errors index to keep the throw consistent with the rest of
 * the codebase.
 */
export function assertContentAllowed(text: string): void {
  const result = checkContent(text);
  if (!result.allowed) {
    // Lazy import to avoid circular deps — the error classes are in
    // ../../errors which should never import this module.
    const { ValidationError } = require("../../errors/index.js");
    throw new ValidationError(
      "Your input contains content that cannot be processed. Please rephrase and try again.",
    );
  }
}
