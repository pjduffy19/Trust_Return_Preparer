# Trust Return Preparer

A bounded, AI-assisted prototype that helps a staff tax associate prepare a **draft** Form 1041 for **simple and complex trusts**, tax year **2025**. Built for MAC 8341.

**Synthetic data only.** Do not enter real taxpayer names, SSNs, EINs or documents. Every output is a draft for professional review. Nothing is filed with the IRS.

## Run it

Open the GitHub Pages site for this repo. There is no build step and no server code. To run it locally, serve the folder (for example `python -m http.server`) and open the address it prints.

To use AI-assisted intake, paste your own Google Gemini API key on the first screen. The key is held in the tab's session storage, sent only to the provider, and cleared when the tab closes. Without a key, the app runs in manual-entry mode.

## Build status

| Milestone | What | Status |
|---|---|---|
| 1 | Repo skeleton, UI shell (light/dark), API key handling, session-only state | Built |
| 2 | Document upload, two-method extraction, validations, confidence, source panel | Not started |
| 3 | Trust profile questions, simple/complex classification, out-of-scope refusal, prior-year flow | Not started |
| 4 | Rules engine, cited constants, test cases 1–4 | Not started |
| 5 | Review gate, escalations, test cases 5–7 | Not started |
| 6 | PDF field mapping and filling, review log export, reviewer sign-off | Not started |
| 7 | Full README, known limitations, boundary check | Not started |

## Layout

```
index.html            app shell (four screens)
styles.css            light and dark themes via CSS variables
app.js                UI, chat flow, session state
ai.js                 provider adapter, schema validation, SSN/EIN redaction
extract.js            document reading (stub)
rules/engine.js       deterministic tax calculations (stub)
rules/constants_2025.js   2025 constants, each cited to the instructions (stub)
pdf/fill.js           fills the IRS PDFs (stub)
pdf/field_map_2025.json   return line -> PDF field name (stub)
knowledge/irs_excerpts.json   the only text the AI may cite (stub)
sources/              IRS PDFs
tests/tests.html      rules-engine test runner (stub)
```

## Sources

In `sources/`, all from irs.gov: Form 1041 (2025) and its instructions; Schedule K-1 (Form 1041) and its beneficiary instructions; Schedule D (Form 1041) and its instructions; and the instructions for Forms 1099-INT (Rev. January 2024), 1099-DIV (Rev. January 2024) and 1099-B (2025).

## Design decisions

- **Documents first.** The user drops documents first and then answers the trust-profile questions the documents cannot answer, as in the approved mockup. This reverses the order in the original build prompt, so milestones 2 and 3 are swapped.
- **Runs from GitHub Pages.** The app is served over https, so data files are plain `.json` and the IRS PDFs are fetched from `sources/`.

## What is stored where

- Returns, documents, answers and the log: memory only, gone when the tab closes.
- API key: `sessionStorage`, this tab only.
- Theme: `localStorage`. Nothing else is saved.
