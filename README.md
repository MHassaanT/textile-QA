# Zarea QA Studio

Zarea QA Studio uses AI vision to help textile teams spot fabric defects and make consistent quality decisions faster.

## What it does

Upload, capture, or select a fabric image to receive a structured quality assessment with a pass, warning, or fail status, defect locations, confidence scores, and practical recommendations. The AI contribution is straightforward: Gemma 4 examines the image and turns visible fabric anomalies into a readable inspection report, while the application organizes that report for a human reviewer.

## Model and license

This project uses **Gemma 4 26B A4B IT** (`gemma-4-26b-a4b-it`) for every inspection through the Gemini API. If inline image input fails or times out, the app retries the same Gemma model through Google's Files API. Gemma 4 is released under the [Apache 2.0 license](https://ai.google.dev/gemma/apache_2) according to the [official Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4). The model is accessed as a hosted API; this repository does not bundle model weights. Gemini API use requires a Google AI Studio API key and is subject to Google's API terms.

## Getting started

Requirements: Node.js 18.17 or newer and a Gemini API key.

```bash
npm install
cp .env.example .env.local
```

Set `GEMINI_API_KEY` in `.env.local`, then run:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The demo presets have local sample results so they can be explored without an API key. Uploaded or captured images require the key.

## Audit history

Inspection history is stored in browser `localStorage` by default. To persist audit events centrally, configure a `DATABASE_URL` and implement the adapter in `lib/audit-store.ts` for your chosen PostgreSQL or Supabase deployment. The default does not transmit audit history to a database.

## Security and limitations

- Keep `.env.local` private; `.env` files are ignored by Git.
- Images sent for live inspection are transmitted to the Gemini API.
- This prototype provides decision support. A qualified inspector should verify findings before dispositioning production material.
- Demo preset outputs are illustrative and are not AI-generated inspection results.

## Contributing

Issues and pull requests are welcome. Please describe the defect or use case, include steps to reproduce UI problems, and avoid committing credentials or production fabric images.

## License

The application code in this repository is available under the MIT License. The Gemma model is separately licensed under Apache 2.0; see the linked Google terms for model use and distribution conditions.
