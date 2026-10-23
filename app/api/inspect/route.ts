import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Hard ceiling for the whole request. Primary + fallback attempts below are budgeted to fit inside it.
export const maxDuration = 60;

const PRIMARY_MODEL = process.env.INSPECT_MODEL || "gemma-4-26b-a4b-it";
// Second attempt when the first errors (5xx/429) or is too slow. Defaults to Gemma again (project requires Gemma 4).
const FALLBACK_MODEL = process.env.INSPECT_FALLBACK_MODEL || PRIMARY_MODEL;
const PRIMARY_TIMEOUT_MS = Number(process.env.INSPECT_PRIMARY_TIMEOUT_MS) || 22_000;
const FALLBACK_TIMEOUT_MS = 25_000;

const prompt = `Act as an expert Textile Quality Assurance Inspection AI. Analyze the provided fabric image for visible anomalies or defects such as oil spots, color bleeds, torn weave, missing warp threads, dirt stains, or uneven dyeing. Be conservative: do not invent defects that are not visible. Return only valid JSON, no markdown, no extra text, matching exactly this structure: {"fabric_quality":"PASS"|"WARNING"|"FAIL","overall_score":85,"summary":"One short sentence overview.","defects":[{"id":"def-1","type":"Oil Stain","severity":"CRITICAL"|"MEDIUM"|"LOW","location_description":"Top-right quadrant, near selvedge edge","confidence":0.94,"recommendation":"Cut out section or re-wash batch"}]}. Score must be an integer from 0 to 100. Confidence must be from 0 to 1. List at most 5 defects, most severe first. Keep every string under 15 words. Use an empty defects array when none are visible. PASS means no meaningful visible defect, WARNING means minor/reviewable issue, FAIL means a significant defect.`;

const resultSchema = {
  type: "OBJECT",
  properties: {
    fabric_quality: { type: "STRING", enum: ["PASS", "WARNING", "FAIL"] },
    overall_score: { type: "INTEGER" },
    summary: { type: "STRING" },
    defects: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          type: { type: "STRING" },
          severity: { type: "STRING", enum: ["CRITICAL", "MEDIUM", "LOW"] },
          location_description: { type: "STRING" },
          confidence: { type: "NUMBER" },
          recommendation: { type: "STRING" },
        },
        required: ["id", "type", "severity", "location_description", "confidence", "recommendation"],
      },
    },
  },
  required: ["fabric_quality", "overall_score", "summary", "defects"],
} as const;

function validateResult(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Model returned an invalid result.");
  const result = value as Record<string, unknown>;
  if (!["PASS", "WARNING", "FAIL"].includes(String(result.fabric_quality))) throw new Error("Model response has an invalid fabric_quality.");
  if (typeof result.overall_score !== "number" || result.overall_score < 0 || result.overall_score > 100) throw new Error("Model response has an invalid overall_score.");
  if (typeof result.summary !== "string" || !Array.isArray(result.defects)) throw new Error("Model response is missing summary or defects.");
  for (const item of result.defects) {
    if (!item || typeof item !== "object") throw new Error("Model response contains an invalid defect.");
    const defect = item as Record<string, unknown>;
    if (typeof defect.id !== "string" || typeof defect.type !== "string" || !["CRITICAL", "MEDIUM", "LOW"].includes(String(defect.severity)) || typeof defect.location_description !== "string" || typeof defect.recommendation !== "string" || typeof defect.confidence !== "number" || defect.confidence < 0 || defect.confidence > 1) throw new Error("Model response contains an incomplete defect.");
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

async function runModel(ai: GoogleGenAI, model: string, mimeType: string, data: string, timeoutMs: number) {
  const isGemini = model.startsWith("gemini");
  const response = await ai.models.generateContent({
    model,
    contents: [{ inlineData: { mimeType, data } }, prompt],
    config: {
      responseMimeType: "application/json",
      temperature: 0,
      maxOutputTokens: 800,
      abortSignal: AbortSignal.timeout(timeoutMs),
      // Gemma 4 and Gemini 2.5 "think" by default; thinking tokens are generated at ~40 tok/s, which is
      // where tens of seconds go. Defect detection doesn't need it.
      ...(model.startsWith("gemma-4") ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } } : {}),
      ...(/^gemini-2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      // Schema-constrained output is faster and removes malformed-JSON retries. Only on Gemini models.
      ...(isGemini ? { responseSchema: resultSchema } : {}),
    },
  });
  if (!response.text) throw new Error("The model returned an empty response.");
  return validateResult(JSON.parse(response.text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()));
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

    const plan: Array<{ model: string; timeoutMs: number }> = [{ model: PRIMARY_MODEL, timeoutMs: PRIMARY_TIMEOUT_MS }];
    plan.push({ model: FALLBACK_MODEL, timeoutMs: FALLBACK_TIMEOUT_MS });

    let lastKind: "timeout" | "transient" = "transient";
    for (const step of plan) {
      const startedAt = Date.now();
      try {
        const result = await runModel(ai, step.model, file.type, base64Data, step.timeoutMs);
        console.log(`inspect ok model=${step.model} ms=${Date.now() - startedAt}`);
        return NextResponse.json({ ...result, model_used: step.model });
      } catch (error) {
        const kind = classifyUpstream(error);
        console.error(`inspect fail model=${step.model} ms=${Date.now() - startedAt} kind=${kind}:`, error instanceof Error ? error.message : error);
        if (kind === "other" && !(error instanceof SyntaxError)) throw error;
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