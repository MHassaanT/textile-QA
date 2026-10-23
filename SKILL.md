---
name: textile-qa-studio
description: Project instructions for maintaining and using Zarea QA Studio's textile inspection flow. Apply when changing the inspection prompt, model/API route, image handling, results, demo samples, or audit history.
---

# Textile QA Studio

Use this file as the project-specific source of instructions for AI inspection behavior and the code that implements it. Keep it aligned with `app/api/inspect/route.ts`, `app/page.tsx`, and `lib/types.ts`.

## Model requirements

- Use **Gemma 4 26B A4B IT** with the exact model ID `gemma-4-26b-a4b-it` for every live inspection.
- Call Gemma through the `@google/genai` SDK and Gemini API using the server-side `GEMINI_API_KEY`.
- Do not substitute or add a Gemini model, another provider, or a non-Gemma fallback. The retry must use the same Gemma model.
- Keep the API key on the server. Never expose it in client code, logs, or committed files.
- Keep Gemma's thinking level minimal. Fabric defect classification does not need extended reasoning.

## Inspection behavior

Act as a textile quality inspector. Examine only what is visible in the supplied fabric image. Look for:

- Oil or dirt stains
- Color bleed or uneven dyeing
- Torn weave or holes
- Missing warp or weft threads

Be conservative. Do not invent a defect, its cause, or its location. Prefer a concise report with up to three visible defects, ordered from most severe to least severe. If the image is unclear, state the uncertainty through lower confidence and cautious recommendations.

Use these status meanings:

- `PASS`: no meaningful visible defect
- `WARNING`: visible minor issue that needs review
- `FAIL`: visible significant damage that can affect the fabric or product

## Response contract

Return only valid JSON. Do not include markdown fences, explanation, or reasoning. The response must use this structure:

```json
{
  "fabric_quality": "PASS",
  "overall_score": 90,
  "summary": "One short sentence about the inspected sample.",
  "defects": [
    {
      "id": "def-1",
      "type": "Torn Weave",
      "severity": "CRITICAL",
      "location_description": "Center of sample",
      "confidence": 0.95,
      "recommendation": "Reject damaged section."
    }
  ]
}
```

Rules:

- `fabric_quality` must be `PASS`, `WARNING`, or `FAIL`.
- `overall_score` is a number from 0 through 100; higher means better visible quality.
- `summary` is one concise sentence.
- `defects` is an array; use `[]` when no defect is visible.
- Each defect includes all six fields shown above.
- `severity` must be `CRITICAL`, `MEDIUM`, or `LOW`.
- `confidence` is a number from 0 through 1. Do not present it as a guarantee.
- Keep locations specific but brief, such as a quadrant or center area. Do not claim pixel-level localization.
- Recommendations should be practical inspection or disposition steps, not unsupported claims about repair success.

The API validates and normalizes model output. It trims and uppercases status/severity, maps common severity aliases, and supplies cautious defaults for omitted defect details. Do not rely on normalization as a replacement for asking Gemma for the complete response contract.

## Image handling and retry behavior

- The browser converts supported images to JPEG and scales the longest edge to at most 1024 pixels before live inspection.
- The API accepts JPEG, PNG, WebP, HEIC, and HEIF images up to 12 MB.
- First send image bytes inline to Gemma. If that request fails or times out, retry **the same Gemma model** through the Gemini Files API.
- Before using a Files API URI, wait for the uploaded file state to become `ACTIVE`. A `PROCESSING` file is not ready for inference.
- Delete temporary Gemini uploads after use. Report failures clearly; never return a fabricated inspection result when both attempts fail.
- The route limits hidden SDK retries and bounds each attempt to fit its Vercel function budget. Preserve this behavior when changing latency settings.

## Application behavior

- Live inspections go through `app/api/inspect/route.ts`; do not call the model directly from the browser.
- Demo gallery buttons use fixed illustrative results in `app/page.tsx`; they do not call Gemma. Keep the demo UI and README clear about this distinction.
- When there is no result or an inspection fails, show a pending/error state. Never display a stale `PASS` or “all clear” result for an uninspected image.
- Audit history is stored in browser `localStorage`. Do not imply it is shared or persisted to a server database.
- Verify that sample images used by the gallery are served from `public/samples/` so they work in production deployments.

## Privacy and safety

- Images are sent to Google's Gemini API for live inspection. Files API fallback uploads are temporary and should be deleted after inference; Google documents temporary Files API storage and automatic expiry.
- Do not log image bytes, API keys, or unnecessary image contents. Log the model, transport, duration, and sanitized error details needed to debug failures.
- Treat results as decision support. Do not claim automated inspection is a certified quality determination; a human inspector should review consequential production decisions.

## Change checklist

When changing inspection behavior:

1. Keep the model ID fixed to `gemma-4-26b-a4b-it` for primary and retry calls.
2. Preserve JSON output, runtime validation, and clear error responses.
3. Preserve browser-side image normalization and the upload size/type checks.
4. Ensure failed requests cannot leave a stale success badge visible.
5. Update this file and `README.md` when model, retry, privacy, or persistence behavior changes.
6. Run `npm run typecheck` after TypeScript changes.
