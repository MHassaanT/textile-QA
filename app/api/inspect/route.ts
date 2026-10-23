import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
// One inline attempt plus one same-model Files API retry.
export const maxDuration = 45;

const MODEL = "gemma-4-26b-a4b-it";
const PRIMARY_TIMEOUT_MS = 15_000;
const FALLBACK_TIMEOUT_MS = 18_000;

const prompt = `You are a textile fabric quality inspector. Inspect the image for visible oil/dirt stains, color bleed, torn weave, missing threads, or uneven dyeing. Be conservative and report only visible defects. Do not provide reasoning. Return only this JSON: {"fabric_quality":"PASS","overall_score":90,"summary":"One short sentence.","defects":[{"id":"def-1","type":"Torn Weave","severity":"CRITICAL","location_description":"Center of sample","confidence":0.95,"recommendation":"Reject damaged section."}]}. fabric_quality must be exactly PASS, WARNING, or FAIL. Score is an integer 0-100. Confidence is 0-1. Report at most 3 defects, most severe first. Keep summary, location, and recommendation brief. Use defects:[] when no defects are visible. PASS means no meaningful defect; WARNING means minor; FAIL means significant damage.`;

function validateResult(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Model returned an invalid result.");
  const result = value as Record<string, unknown>;
  const quality = typeof result.fabric_quality === "string" ? result.fabric_quality.trim().toUpperCase() : "";
  if (!["PASS", "WARNING", "FAIL"].includes(quality)) {
    throw new Error(`Model response has an invalid fabric_quality: ${JSON.stringify(result.fabric_quality)}`);
  }
  result.fabric_quality = quality;
  if (typeof result.overall_score !== "number" || result.overall_score < 0 || result.overall_score > 100) throw new Error("Model response has an invalid overall_score.");
  if (typeof result.summary !== "string" || !Array.isArray(result.defects)) throw new Error("Model response is missing summary or defects.");
  for (const item of result.defects) {
    if (!item || typeof item !== "object") throw new Error("Model response contains an invalid defect.");
    const defect = item as Record<string, unknown>;
    const severity = typeof defect.severity === "string" ? defect.severity.trim().toUpperCase() : "";
    if (typeof defect.id !== "string" || typeof defect.type !== "string" || !["CRITICAL", "MEDIUM", "LOW"].includes(severity) || typeof defect.location_description !== "string" || typeof defect.recommendation !== "string" || typeof defect.confidence !== "number" || defect.confidence < 0 || defect.confidence > 1) throw new Error("Model response contains an incomplete defect.");
    defect.severity = severity;
  }
  return result;
}

type Upstream = { status?: number; code?: number; name?: string; message?: string; error?: { code?: number; status?: string; message?: string } };

// The SDK throws a plain Error("Retryable HTTP Error: Internal Server Error") with NO status field
// for 429/500/503, so status-only checks miss it. Classify by status, abort/timeout, and message text.
function classifyUpstream(error: unknown): "timeout" | "transient" | "other" {
  if (!error || typeof error !== "object") return "other";
  const e = error as Upstream;
  const text = `${e.name ?? ""} ${e.message ?? ""} ${e.error?.message ?? ""} ${e.error?.status ?? ""}`;
  if (e.name === "AbortError" || e.name === "TimeoutError" || /abort|timed? ?out|timeout/i.test(text)) return "timeout";
  const status = e.status ?? e.code ?? e.error?.code;
  if (status === 429 || (typeof status === "number" && status >= 500)) return "transient";
  if (/Retryable HTTP Error|Internal Server Error|Service Unavailable|Bad Gateway|Gateway Time|Too Many Requests|INTERNAL|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(text)) return "transient";
  return "other";
}

function upstreamErrorMessage(kind: "timeout" | "transient") {
  return kind === "timeout"
    ? "The AI model took too long to respond. Please retry."
    : "The AI service is temporarily busy. Please retry in a moment.";
}

async function runModel(ai: GoogleGenAI, mimeType: string, data: string, timeoutMs: number, transport: "inline" | "file", displayName: string) {
  let uploaded: Awaited<ReturnType<typeof ai.files.upload>> | undefined;
  try {
    const imagePart = transport === "inline"
      ? { inlineData: { mimeType, data } }
      : await (async () => {
          uploaded = await ai.files.upload({
            file: new Blob([Buffer.from(data, "base64")], { type: mimeType }),
            config: { mimeType, displayName: displayName.slice(0, 100) || "fabric-sample", abortSignal: AbortSignal.timeout(5_000) },
          });
          if (!uploaded.uri) throw new Error("Gemma image upload did not return a file URI.");
          return { fileData: { fileUri: uploaded.uri, mimeType } };
        })();
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [imagePart, prompt],
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        maxOutputTokens: 400,
        abortSignal: AbortSignal.timeout(timeoutMs),
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
    });
    if (!response.text) throw new Error("The model returned an empty response.");
    return validateResult(JSON.parse(response.text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()));
  } finally {
    if (uploaded?.name) {
      try {
        await ai.files.delete({ name: uploaded.name, config: { httpOptions: { timeout: 5_000, retryOptions: { attempts: 1 } } } });
      } catch (error) {
        console.warn("Gemma temporary-file cleanup failed:", error instanceof Error ? error.message : error);
      }
    }
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("image");
    if (!(file instanceof File)) return NextResponse.json({ error: "Please attach a fabric image in the 'image' field." }, { status: 400 });
    const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
    if (!supportedTypes.has(file.type)) return NextResponse.json({ error: "Use a JPG, PNG, WebP, HEIC, or HEIF image." }, { status: 400 });
    if (file.size > 12 * 1024 * 1024) return NextResponse.json({ error: "Image must be smaller than 12 MB." }, { status: 413 });
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY is not configured. Add it to .env.local to inspect uploaded images." }, { status: 500 });
    const base64Data = Buffer.from(await file.arrayBuffer()).toString("base64");
    // attempts:1 = no hidden SDK retries (they stack on top of each other and blow the time budget).
    // We do our own bounded fallback below instead.
    const ai = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });

    const plan: Array<{ timeoutMs: number; transport: "inline" | "file" }> = [
      { timeoutMs: PRIMARY_TIMEOUT_MS, transport: "inline" },
      { timeoutMs: FALLBACK_TIMEOUT_MS, transport: "file" },
    ];

    let lastKind: "timeout" | "transient" = "transient";
    for (const step of plan) {
      const startedAt = Date.now();
      try {
        const result = await runModel(ai, file.type, base64Data, step.timeoutMs, step.transport, file.name);
        console.log(`inspect ok model=${MODEL} transport=${step.transport} ms=${Date.now() - startedAt}`);
        return NextResponse.json({ ...result, model_used: MODEL });
      } catch (error) {
        const kind = classifyUpstream(error);
        console.error(`inspect fail model=${MODEL} transport=${step.transport} ms=${Date.now() - startedAt} kind=${kind}:`, error instanceof Error ? error.message : error);
        const modelOutputError = error instanceof Error && error.message.startsWith("Model response");
        if (kind === "other" && !(error instanceof SyntaxError) && !modelOutputError) throw error;
        lastKind = kind === "timeout" ? "timeout" : "transient";
      }
    }
    return NextResponse.json({ error: upstreamErrorMessage(lastKind) }, { status: 502 });
  } catch (error) {
    console.error("Fabric inspection failed:", error instanceof Error ? error.message : error);
    const message = error instanceof Error ? error.message : "Unexpected error while inspecting the image.";
    return NextResponse.json({ error: `Inspection failed: ${message}` }, { status: 500 });
  }
}
