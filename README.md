# ApprovalOS

A zero-cost, local hackathon MVP for explaining and orchestrating India industrial approvals. It is a smart layer beside NSWS, not a government-system integration.

## Run locally

```bash
npm install
cp .env.example .env.local # optional: add GEMINI_API_KEY for live answers
npm run dev
```

Open `http://localhost:3000`.

The demo is fully usable without an API key: `/api/ask` uses the small curated local knowledge base in `data/regulations/` and gracefully falls back whenever Gemini is unavailable. The model is configurable through `GEMINI_MODEL`; the default free-tier Flash model is `gemini-3-flash-preview`.

Document uploads run deterministic type/size checks immediately, then optionally call `/api/validate-document` for OCR field extraction. The validator uses a document-specific rule: pollution consent permits a missing expiry, Fire NOCs use Maharashtra's 1-year or Gujarat's 3-year cycle, MIDC allotments require possession and plot details, and labour licences follow the Factory or Shops & Establishment path based on sector. Date labels are phrase-order-flexible and support slash, dot, and hyphen formats. PDFs retain their structural approval when local OCR tooling is unavailable instead of being rejected solely because content extraction is unavailable. The browser console records either `Document validation: AI` or `Document validation: deterministic fallback`; an OCR failure is intentionally invisible in the UI.

The OCR demo fixtures in `data/fixtures/` cover the MIDC possession-date path and the distinct Maharashtra and Gujarat Fire NOC validity windows.

## Demo path

1. Enter as Applicant → **New application** → generate the checklist → upload any PDF against Fire NOC to see a reliable visible validation failure.
2. Open **My status** to present the approval dependencies and parallel work.
3. Switch to Officials → **Applications** for risk/SLA queue and department chart.
4. Open **Inspection planner** to schedule the suggested Anand GIDC joint visit.
5. Ask the regulatory copilot, e.g. “What is required for a Fire NOC?” Its source document is always shown.

Use **Reset demo data** in the top bar (or `Cmd/Ctrl+Shift+R`) between rehearsal runs. It restores the landing screen, persona, form, uploads, chat state and inspection scheduling state to their seeded defaults.

All SLAs, dates, applications and performance estimates are illustrative mock data for the demo.
