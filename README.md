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
| 2 | Document upload, two-method extraction, validations, confidence, source panel | Built |
| 3 | Trust profile questions, simple/complex classification, out-of-scope refusal, prior-year flow | Built |
| 4 | Rules engine, cited constants, test cases 1–4 | Built |
| 5 | Review gate, escalations, test cases 5–7 | Not started |
| 6 | PDF field mapping and filling, review log export, reviewer sign-off | Not started |
| 7 | Full README, known limitations, boundary check | Not started |

## How documents are read

1. **Classify.** Rules look for the form name in the PDF's text layer: 1099-INT, 1099-DIV, 1099-B, the trustee's distribution and expense summary, or a prior-year Form 1041 (held for the trust profile step).
2. **Read twice.** A rule-based parser finds each box label and the amount beside or beneath it. If an AI key is connected, the AI also reads the page and must return each amount with an exact quote and page number. SSNs and EINs are redacted before any text is sent.
3. **Check.** Code confirms the quote is really on that page and contains the amount, compares the two reads, and runs validation rules (for example, qualified dividends cannot exceed ordinary dividends).
4. **Score.** High: both reads agree, the quote checks out and the rules pass, or you confirmed the value. Medium: one read only, or a non-standard document. Low: the reads disagree, the evidence fails, or a rule fails. The AI never rates itself.

Scans and images have no text layer and cannot be redacted, so they are never sent to the AI. They go to manual entry. Boxes this tool does not compute (foreign tax, Section 199A dividends, wash sales, backup withholding and other unusual boxes) are flagged for the reviewer.

Click any row to open the source page with the amount highlighted, then confirm or correct it.

## The trust profile

After the documents are read, the app asks what they cannot answer, one question at a time. Each card says why it is asked and cites an IRS excerpt, which opens when you click the source tag. This step uses no AI at all.

- **Scope.** Estates, grantor trusts, ESBTs, qualified disability trusts, bankruptcy estates, pooled income funds, foreign trusts and trusts with business or rental income are refused with an explanation.
- **Simple or complex.** Three questions apply the simple-trust test from the Form 1041 instructions. The rules propose the result and you confirm it. A trust that is simple on paper but distributed principal is complex for the year.
- **Header and Other Information.** Name, EIN, date created, fiduciary, initial/final/amended, changes since last year, beneficiaries and shares, how gains and trustee fees are allocated, and the Other Information questions on page 3.
- **Prior year.** A prior-year return is read like any other document and compared with your answers: EIN, name, classification, beneficiaries and capital loss carryovers. Differences become follow-up questions or Low items.
- **Not sure** is always allowed. It becomes a Low item for the reviewer, never a guess. Elections and anything outside the rules are escalated.

SSNs and EINs are typed into masked boxes, kept in memory for the final PDF only, and never logged or sent to the AI.

## The calculation

`rules/engine.js` computes the return in form order, with no AI: Schedule D, page 1 income and deductions, Schedule B (distributable net income and the income distribution deduction), the exemption, taxable income, the tax on Schedule G line 1a, and each beneficiary's Schedule K-1 amounts. Every step is recorded with the IRS excerpt it applies. The calculation is not yet shown in the app; that comes with the review gate.

- **Constants** are in `rules/constants_2025.js`, each copied from the IRS PDFs with its page number: the 2025 tax rate schedule, the capital gain breakpoints, the exemptions, the capital loss limit and the NIIT threshold.
- **Tax** uses Schedule D Part V (or the Qualified Dividends Tax Worksheet) when there are capital gains or qualified dividends kept by the trust, and the rate schedule otherwise.
- **Method choices** are listed as assumptions for the reviewer: expenses go to tax-exempt income in proportion to gross accounting income; other deductions are spread over interest and dividends in proportion; qualified dividends follow the share of DNI distributed.
- **Refusals.** The engine will not compute when the classification, the capital gain allocation or the fee allocation is undecided, when there are charitable amounts (Schedule A), or for a complex trust with gains allocated to income.
- **Not computed:** Net Investment Income Tax (flagged when taxable income is above the threshold), alternative minimum tax, credits, estimated tax payments and next year's capital loss carryover.

## Tests

Open `tests/tests.html` on the site, or run `node tests/run.js`. Cases 1 to 4, plus the engine parts of cases 5 and 7 and a check of the rate schedule, are compared with figures worked out by hand.

## Sample documents

`samples/` holds synthetic PDFs, each stamped "SAMPLE - SYNTHETIC DATA". "Try the sample documents" on the first screen loads `samples/case1`. Regenerate them with `python scripts/make_samples.py` (needs `reportlab` and `pillow`).

- `case1/` baseline simple trust: 1099-INT, 1099-DIV, 1099-B and the trustee's summary
- `case4/` tax-exempt interest plus trustee fees
- `case6/` a scan with no text layer (goes to manual entry)
- `case7/` a prior-year return with a long-term capital loss carryover and two K-1s
- `checks/` documents that trip the checks: qualified above ordinary dividends, foreign tax and Section 199A dividends, a short-term wash sale

## Known limitations so far

- The parser expects one transaction or one total per 1099-B. Multi-lot broker statements are not split into lots.
- The short-term or long-term box is read only when it is printed as text, such as "[X] Long-term". If it is not found, the item is Low and you choose it.
- Descriptions and dates on Form 1099-B are not captured.
- Scans and photos are not read at all; their values are typed in by hand.
- A prior-year return is read only when its values are in the page text, as in the sample. A return saved from the IRS fillable PDF keeps its values in form fields, which are not read yet; the app then asks for last year's classification and carryovers instead.
- Beneficiary shares are not on a Schedule K-1, so only names are compared with last year.
- On the source page, full SSNs and EINs found in the text layer are painted over, leaving the last 4 digits. Positions inside a run of text are estimated, so a mask can be a little wide or narrow. Scanned pages have no text layer, so they cannot be masked; the panel says so.

## Layout

```
index.html            app shell (four screens)
styles.css            light and dark themes via CSS variables
app.js                UI, chat flow, session state
ai.js                 provider adapter, schema validation, SSN/EIN redaction
extract.js            document reading: classify, parse, AI read, checks, confidence
profile.js            trust profile questions, classification rule, scope and reviewer flags
rules/engine.js       deterministic tax calculations
rules/constants_2025.js   2025 constants, each cited to its IRS page
pdf/fill.js           fills the IRS PDFs (stub)
pdf/field_map_2025.json   return line -> PDF field name (stub)
knowledge/irs_excerpts.json   the only text the app may cite
samples/              synthetic test documents
scripts/make_samples.py   regenerates the samples
scripts/check_excerpts.py verifies every excerpt appears in its source PDF
sources/              IRS PDFs
tests/tests.html      rules-engine test page (tests/cases.js holds the cases; tests/run.js runs them in Node)
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
