import { getOllamaComplianceModel, getOllamaBaseUrl } from "@/lib/ollama";

let warmed = false;

/** Keep the compliance model loaded in GPU memory before a long audit run. */
export async function warmupOllamaComplianceModel(): Promise<void> {
  if (warmed) return;
  const model = getOllamaComplianceModel();
  try {
    const res = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: 'Return JSON: {"ok":true}' }],
        format: "json",
        stream: false,
        keep_alive: "30m",
        options: { num_predict: 16, temperature: 0 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok) {
      warmed = true;
      console.log(`[ollama] warmed compliance model: ${model}`);
    }
  } catch {
    console.warn(`[ollama] warmup skipped for ${model}`);
  }
}
