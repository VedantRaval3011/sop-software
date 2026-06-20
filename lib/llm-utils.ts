export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Surface the underlying network cause (undici hides it in `error.cause`). */
export function errorDetail(error: unknown): string {
  const parts: string[] = [errorMessage(error)];
  const cause = (error as { cause?: unknown })?.cause;
  if (cause) {
    const c = cause as { code?: string; message?: string; errno?: number };
    parts.push(`cause=${c.code ?? c.errno ?? ""} ${c.message ?? String(cause)}`.trim());
  }
  const status = (error as { status?: number })?.status;
  if (status) parts.push(`status=${status}`);
  return parts.join(" | ");
}

export function isJsonParseError(error: unknown): boolean {
  const msg = errorMessage(error);
  return (
    error instanceof SyntaxError ||
    msg.includes("JSON") ||
    msg.includes("Unexpected token") ||
    msg.includes("Unexpected end")
  );
}

/**
 * A pure network/connection failure (no HTTP response). Retrying these 8× across
 * fallback models is pointless — every model shares the same broken connection.
 */
export function isConnectionError(error: unknown): boolean {
  if (typeof (error as { status?: number })?.status === "number") return false;
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  const code = cause?.code ?? "";
  const blob = `${errorMessage(error)} ${cause?.message ?? ""} ${code}`.toLowerCase();
  if (
    /econnreset|econnrefused|etimedout|enotfound|eai_again|epipe|und_err|socket hang up|fetch failed|network|terminated|certificate/.test(
      blob,
    )
  ) {
    return true;
  }
  const msg = errorMessage(error);
  return msg.includes("Error fetching from") && !/\[\d{3}\b/.test(msg);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function stripMarkdownFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

/** Salvage complete finding objects from truncated JSON responses. */
export function extractCompleteObjects(text: string): unknown[] {
  const objects: unknown[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const chunk = text.slice(start, i + 1);
        if (chunk.includes('"clauseNumber"') || chunk.includes('"complianceLevel"')) {
          try {
            objects.push(JSON.parse(chunk));
          } catch {
            /* skip malformed object */
          }
        }
        start = -1;
      }
    }
  }
  return objects;
}

export function repairTruncatedJson(text: string): string {
  let s = stripMarkdownFences(text);
  const openBraces = (s.match(/\{/g) ?? []).length;
  const closeBraces = (s.match(/\}/g) ?? []).length;
  const openBrackets = (s.match(/\[/g) ?? []).length;
  const closeBrackets = (s.match(/\]/g) ?? []).length;

  s = s.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"{}[\]]*$/, "");
  s = s.replace(/,\s*$/, "");

  if (openBrackets > closeBrackets) s += "]".repeat(openBrackets - closeBrackets);
  if (openBraces > closeBraces) s += "}".repeat(openBraces - closeBraces);
  return s;
}

export function parseJsonFromText<T>(text: string, logPrefix = "llm"): T {
  const cleaned = stripMarkdownFences(text);

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    /* continue */
  }

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as T;
    } catch {
      try {
        return JSON.parse(repairTruncatedJson(jsonMatch[0])) as T;
      } catch {
        /* continue */
      }
    }
  }

  const objects = extractCompleteObjects(cleaned);
  if (objects.length > 0) {
    console.warn(`[${logPrefix}] salvaged ${objects.length} complete finding(s) from truncated JSON`);
    return { findings: objects, overallScore: 0 } as T;
  }

  throw new SyntaxError(`LLM response was not valid JSON: ${cleaned.slice(0, 200)}`);
}
