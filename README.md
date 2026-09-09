# Permit Sync

A zero-cost, local hackathon MVP for explaining and orchestrating India industrial approvals. It is a smart layer beside NSWS, not a government-system integration.

## Run locally

```bash
npm install
cp .env.example .env.local # optional: add GEMINI_API_KEY for live answers
npm run dev
```

Open `http://localhost:3000`.

The demo is fully usable without an API key: `/api/ask` uses the small curated local knowledge base in `data/regulations/` and gracefully falls back whenever Gemini is unavailable. The model is configurable through `GEMINI_MODEL`; the default free-tier Flash model is `gemini-3-flash-preview`.

Document uploads run deterministic type/size checks immediately, then use browser-side Tesseract.js OCR for image documents before applying the type-aware validation rules. The validator uses a document-specific rule: pollution consent permits a missing expiry, Fire NOCs use Maharashtra's 1-year or Gujarat's 3-year cycle, MIDC allotments require possession and plot details, and labour licences follow the Factory or Shops & Establishment path based on sector. Date labels are phrase-order-flexible and support slash, dot, and hyphen formats. PDFs receive structural validation because Tesseract.js does not render PDF pages; export a document as PNG/JPG for content OCR. No Gemini/API credit is used by document validation.

The OCR demo fixtures in `data/fixtures/` cover the MIDC possession-date path and the distinct Maharashtra and Gujarat Fire NOC validity windows.

## Demo path

1. Enter as Applicant → **New application** → generate the checklist → upload any PDF against Fire NOC to see a reliable visible validation failure.
2. Open **My status** to present the approval dependencies and parallel work.
3. Switch to Officials → **Applications** for risk/SLA queue and department chart.
4. Open **Inspection planner** to schedule the suggested Anand GIDC joint visit.
5. Ask the regulatory copilot, e.g. “What is required for a Fire NOC?” Its source document is always shown.

Use **Reset demo data** in the top bar (or `Cmd/Ctrl+Shift+R`) between rehearsal runs. It restores the landing screen, persona, form, uploads, chat state and inspection scheduling state to their seeded defaults.

All SLAs, dates, applications and performance estimates are illustrative mock data for the demo.

## Vercel production constraints

Permit Sync can be deployed to Vercel as a demo, but the current architecture has deliberate production limitations:

- **Serverless execution:** API routes run as stateless Vercel Functions. Do not depend on process memory for durable applications, inspections, grievances, alerts, or uploaded files.
- **No durable database:** workflow state is seeded/local React state and resets on reload. A production deployment needs a database and authenticated persistence layer.
- **Ephemeral filesystem:** temporary OCR files are safe only during a single request. Vercel function filesystems are not persistent storage; use object storage for documents.
- **Browser OCR:** image transcription uses Tesseract.js in the applicant's browser, so document validation does not require Gemini credits or a server-side Tesseract executable. PDF content OCR requires converting the PDF to an image before upload.
- **Function duration:** document OCR and Gemini calls are request-bound and subject to the Vercel plan's function timeout. Keep the configured route duration within the selected plan limit and use short AI timeouts.
- **Environment variables:** configure `GEMINI_API_KEY` in Vercel Project Settings for live Gemini responses. The post-submission document review automatically falls back to OpenRouter when Gemini is unavailable; configure `OPENROUTER_API_KEY` and optionally `OPENROUTER_MODEL` for that fallback. Set provider keys only as server-side variables; never expose them with a `NEXT_PUBLIC_` prefix.
- **External integrations:** NSWS, MAITRI, government portals, authentication, notifications, and payment systems are represented as static labels or demo flows; they are not connected.
- **Observability:** use Vercel Function Logs for server-side validation and Gemini diagnostics; browser console logs are not a substitute for production audit logging.

For a production launch, replace local state with a database, add authentication and authorization, store documents in durable object storage, add rate limiting, audit logs, and monitoring. Browser OCR shifts compute to the user's device; consider a supported OCR service only if you need consistent server-side OCR.
