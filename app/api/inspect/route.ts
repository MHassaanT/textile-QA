import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const prompt = `Act as an expert Textile Quality Assurance Inspection AI. Analyze the provided fabric image for visible anomalies or defects such as oil spots, color bleeds, torn weave, missing warp threads, dirt stains, or uneven dyeing. Be conservative: do not invent defects that are not visible. Return only valid JSON matching exactly this structure: {"fabric_quality":"PASS"|"WARNING"|"FAIL","overall_score":85,"summary":"Brief 1-2 sentence executive overview of the fabric batch quality.","defects":[{"id":"def-1","type":"Oil Stain","severity":"CRITICAL"|"MEDIUM"|"LOW","location_description":"Top-right quadrant, near selvedge edge","confidence":0.94,"recommendation":"Cut out section or re-wash batch"}]}. Score must be an integer from 0 to 100. Confidence must be from 0 to 1. Use an empty defects array when none are visible. PASS means no meaningful visible defect, WARNING means minor/reviewable issue, FAIL means a significant defect.`;

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

function isRetryableUpstreamError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: number; code?: number; message?: string; error?: { code?: number; status?: string } };
  const status = candidate.status ?? candidate.code ?? candidate.error?.code;
  return status === 429 || status === 500 || status === 503 || candidate.error?.status === "INTERNAL";
}

function upstreamErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") return "The inspection service returned an unexpected error.";
  const candidate = error as { status?: number; code?: number; message?: string; error?: { code?: number; status?: string; message?: string } };
  const status = candidate.status ?? candidate.code ?? candidate.error?.code;
  const message = candidate.error?.message ?? candidate.message ?? "";
  if (status === 429) return "The inspection service is busy. Please wait a moment and retry.";
  if (status === 500 || status === 503 || candidate.error?.status === "INTERNAL") {
    return "Google's Gemma service encountered a temporary internal error. Please retry in a moment; if it continues, try a smaller JPG or PNG image.";
  }
  return message ? `Gemma inspection failed: ${message}` : "Gemma inspection failed. Please retry.";
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
    const bytes = Buffer.from(await file.arrayBuffer());
    const base64Data = bytes.toString("base64");
    const ai = new GoogleGenAI({ apiKey });
    let response;
    let inlineError: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await ai.models.generateContent({
          model: "gemma-4-26b-a4b-it",
          contents: [{ inlineData: { mimeType: file.type, data: base64Data } }, prompt],
          config: { responseMimeType: "application/json" },
        });
        break;
      } catch (error) {
        // Google occasionally returns a transient 500 after a long vision request.
        // Make one automatic retry for server overloads without repeating other failures.
        if (!isRetryableUpstreamError(error)) throw error;
        inlineError = error;
        if (attempt >= 1) break;
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    }
    if (!response && inlineError) {
      // Fall back to the Gemini Files API. Some valid images intermittently fail
      // when sent inline, even though the model supports the same image via URI.
      const uploaded = await ai.files.upload({
        file: new Blob([bytes], { type: file.type }),
        config: { mimeType: file.type, displayName: file.name.slice(0, 100) || "fabric-sample" },
      });
      try {
        if (!uploaded.uri) throw new Error("Google uploaded the image but did not return a file URI.");
        response = await ai.models.generateContent({
          model: "gemma-4-26b-a4b-it",
          contents: [{ fileData: { fileUri: uploaded.uri, mimeType: file.type } }, prompt],
          config: { responseMimeType: "application/json" },
        });
      } finally {
        if (uploaded.name) {
          try { await ai.files.delete({ name: uploaded.name }); }
          catch (cleanupError) { console.warn("Could not remove temporary Gemini upload:", cleanupError instanceof Error ? cleanupError.message : cleanupError); }
        }
      }
    }
    if (!response) throw inlineError ?? new Error("The model returned no response.");
    if (!response.text) throw new Error("The model returned an empty response.");
    return NextResponse.json(validateResult(JSON.parse(response.text)));
  } catch (error) {
    console.error("Fabric inspection failed:", error instanceof Error ? error.message : error);
    if (isRetryableUpstreamError(error)) return NextResponse.json({ error: upstreamErrorMessage(error) }, { status: 502 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Gemma returned a response that was not valid JSON. Please retry the inspection." }, { status: 502 });
    const message = error instanceof Error ? error.message : "Unexpected error while inspecting the image.";
    return NextResponse.json({ error: `Inspection failed: ${message}` }, { status: 500 });
  }
}
