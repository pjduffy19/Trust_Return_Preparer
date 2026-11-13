# Trust Return Preparer

A bounded, AI-assisted prototype that helps a staff tax associate prepare a **draft** Form 1041 (U.S. Income Tax Return for Estates and Trusts) for **simple and complex trusts**, tax year **2025**. Built for MAC 8341 at Villanova.

**Live site:** https://pjduffy19.github.io/Trust_Return_Preparer/

> **Synthetic data only.** Do not enter real taxpayer names, SSNs, EINs or documents. Every output is a draft for professional review. Nothing is filed with the IRS or sent to anyone.

The AI reads documents and helps answer questions from the IRS sources. **All tax math is done by rule-based code.** The AI never calculates a number on the return, never rates its own confidence, and never decides how anything is taxed.

## Try it in two minutes

1. Open the live site.
2. Click **Try the sample documents**. Four synthetic documents for the "Maple Street Trust" are read.
3. Answer the trust questions (about 29, one click or a short entry each). Use made-up names and numbers.
4. Click **Open the review screen**, then **Generate Form 1041**.
5. Download the filled Form 1041, Schedule D, the Schedule K-1s and the review log, and record a reviewer sign-off.

Everything above works with no API key. A key adds the second, AI read of each document and plain-language answers to questions.

## Get a free Gemini API key (optional)

1. Go to https://aistudio.google.com/app/apikey and sign in with a Google account.
2. Create an API key and copy it. Google may change the exact steps on that page.
3. Paste it into the key box on the app's first screen, or under **Settings & sources**, and press **Connect**.

The key is kept in that browser tab's session storage, sent only to Google's Gemini API, and cleared when the tab closes. It is never in the code or the repository. The free tier has rate limits; if a model is busy the app moves to another one and, failing that, keeps the rule-based read.

## How it works

| Step | What happens | Who decides |
|---|---|---|
| 1. Documents | Each PDF is classified and read twice: by a rule-based parser and, with a key, by the AI, which must quote the page for every value. Code compares the reads and runs validation rules. | Code assigns High, Medium or Low |
| 2. Trust profile | The app asks what the documents cannot answer, one question at a time, each with its reason and IRS source. Rules propose simple or complex. | The user confirms |
| 3. Review gate | Every Low item must be confirmed, corrected or escalated. Generate stays locked until that is done and the return can actually be computed. | The user, then the reviewer |
| 4. Calculation | The rules engine computes Schedule D, page 1, Schedule B, the tax and each Schedule K-1, recording the IRS source of every step. | Rule-based code only |
| 5. Output and sign-off | The official IRS PDFs are filled, stamped as drafts, and downloaded with a review log. A reviewer approves or returns the draft. | The reviewer |

### Documents

- **Read:** Forms 1099-INT, 1099-DIV and 1099-B, the trustee's distribution and expense summary, and a prior-year Form 1041 with its K-1s.
- **Confidence.** High: both reads agree, the AI's quote is on the page and contains the amount, and the checks pass, or you confirmed the value. Medium: one read only, or a non-standard document. Low: the reads disagree, the evidence fails, or a check fails (for example, qualified dividends above ordinary dividends).
- **Source panel.** Click any row to see the page with the amount highlighted, the IRS definition of the box, and Confirm and Edit buttons.
- **Scans and photos** have no text layer and cannot be redacted, so they are never sent to the AI. Their values are typed in by hand, beside the page.
- **Escalated boxes.** Foreign tax, Section 199A dividends, backup withholding and other unusual boxes are flagged for the reviewer. Wash sales, market discount and Form 1099-DIV boxes 2b to 2d stop the calculation, because they change the numbers.

### The trust profile

- **Scope.** Estates, grantor trusts, ESBTs, qualified disability trusts, bankruptcy estates, pooled income funds, foreign trusts and trusts with business or rental income are refused with an explanation.
- **Simple or complex.** Three questions apply the simple-trust test in the Form 1041 instructions. A trust that is simple on paper but distributed principal is complex for the year.
- **Prior year.** A prior-year return is compared with your answers: EIN, name, classification, beneficiaries and capital loss carryovers. Differences become follow-up questions or Low items.
- **Not sure** is always allowed. It becomes a Low item for the reviewer, never a guess.

### The calculation

`rules/engine.js` follows the forms line by line. `rules/constants_2025.js` holds the 2025 rate schedule, capital gain breakpoints, exemptions, the capital loss limit and the NIIT threshold, each copied from the IRS PDFs with its page number.

Where the instructions allow more than one reasonable method, the engine uses one and lists it for the reviewer:

- Expenses are allocated to tax-exempt income in the ratio of tax-exempt income to gross accounting income.
- Other deductions are spread over interest and dividends in proportion to each.
- Qualified dividends are split between the trust and the beneficiaries in proportion to the DNI distributed.

### Questions

Type a question into the message box. The app searches the bundled IRS excerpts and the computed lines of the return.

- **With a key,** the AI answers in a few sentences from those excerpts only and must cite them. Code checks that every cited id is one it supplied; otherwise the answer is discarded.
- **Without a key,** the app quotes the matching excerpts word for word.
- **If nothing matches,** it says the question is outside its sources and adds it to the reviewer's list. It never answers from general knowledge.

## Controls

| Control | How it is enforced |
|---|---|
| Source discipline | `knowledge/irs_excerpts.json` holds 67 excerpts copied from the IRS PDFs in `sources/`. `scripts/check_excerpts.py` verifies each one appears word for word in its PDF. Questions, rules and answers may cite only these ids, and the app checks every id exists. |
| No AI arithmetic | Every number on the return comes from `rules/engine.js`. The AI's only numeric output is a value it read from a page, which must match a quote that code finds on that page. |
| Structured AI output | Every AI call returns JSON at temperature 0, validated against a schema in code. A bad reply is retried once, then the item falls back to the rule-based read or manual entry. |
| Confidence from checks | High, Medium and Low come from code comparing two reads and running validation rules. The model never rates itself. |
| Human gates | The user confirms the classification; every Low item must be resolved; a reviewer signs off. Escalating an undecided fact does not unlock the return. |
| Privacy | SSNs and EINs are redacted from all text before it is sent to the AI, masked on screen (last 4 digits), masked on the displayed source page, and kept out of the log. They are written only onto the downloaded PDFs. |
| Traceability | The review log records every document, read, AI call, confidence change, override, answer, escalation, the classification and its rule, the result and the sign-off. It exports as PDF and JSON. |
| Works without AI | With no key, or when a call fails, the parser, manual entry, the questions, the engine and the outputs all still work. |

## What this app will not do

| It will not | How that is enforced |
|---|---|
| File anything with the IRS | There is no filing code. The app's only network calls are to the AI provider, two pinned libraries on a CDN, a web font, and its own files. |
| Send K-1s to beneficiaries | Outputs are downloads to the user's own device. Nothing is emailed or uploaded. |
| Interpret the trust instrument on its own | The user states what the instrument says. "Silent or not sure" becomes a Low item, and the engine refuses to compute until it is decided. |
| Make tax elections | The 663(b) and 643(e)(3) questions record what the fiduciary decided and escalate a Yes. The election boxes on the form are never checked. |
| Prepare returns outside its scope | Other entity types, foreign trusts and trusts with business or rental income stop the interview, and Generate stays locked. |
| Show full SSNs or EINs | Entry boxes are masked; chat text, names and comments reject or redact them; the source page paints over them; the log masks them. A scanned page cannot be masked, and the app says so. |
| Answer tax questions from other sources | Typed questions are answered only from the bundled excerpts, with citations checked by code. Anything else is declared outside the sources and escalated. |

## Tests

- **Rules engine:** open `tests/tests.html` on the site, or run `node tests/run.js`. Cases 1 to 4, the engine parts of cases 5 and 7, and the rate schedule are checked against figures worked out by hand (80 checks). If the engine and an expected figure disagree, the test fails; the expected figure is not changed to match.
- **Excerpts:** `python scripts/check_excerpts.py` (needs `pdftotext`).
- **Sample documents** in `samples/`, each stamped "SAMPLE - SYNTHETIC DATA". Regenerate with `python scripts/make_samples.py` (needs `reportlab` and `pillow`).

| Folder | Scenario |
|---|---|
| `case1/` | Baseline simple trust: 1099-INT, 1099-DIV, 1099-B and the trustee's summary |
| `case4/` | Tax-exempt interest plus trustee fees |
| `case6/` | A scan with no text layer, which goes to manual entry |
| `case7/` | A prior-year return with a capital loss carryover and two K-1s |
| `checks/` | Documents that trip the checks: qualified above ordinary dividends, foreign tax and Section 199A dividends, a short-term wash sale |

Cases 2, 3 and 5 use the case 1 documents with different answers in the interview.

## Known limitations

**Scope**
- Simple and complex trusts only, tax year 2025 only, U.S. trusts only, federal return only.
- No business, farm or rental income; no charitable deduction (Schedule A); no complex trust with capital gains allocated to income.

**Reading documents**
- The parser reads PDFs with a text layer. Scans and photos are typed in by hand.
- Form 1099-B is read as one transaction or one total per document. Multi-lot broker statements are not split into lots, and descriptions and dates are not captured.
- The short-term or long-term box is read only when it is printed as text, such as "[X] Long-term". Otherwise you choose it.
- A prior-year return is read only when its values are in the page text, as in the sample. A return saved from the IRS fillable PDF keeps its values in form fields, which are not read; the app then asks for last year's classification and carryovers.
- The synthetic samples imitate the box labels of the IRS forms, not their exact layout. Real payer statements vary and may read less well.

**Calculation**
- Not computed: Net Investment Income Tax (flagged when taxable income is above the threshold), alternative minimum tax, credits including the foreign tax credit, the qualified business income deduction, estimated tax payments, withholding, penalties, and next year's capital loss carryover.
- Sales are reported on Schedule D lines 1a and 8a, which assumes basis was reported to the IRS with no adjustments. No Form 8949 is prepared.
- The three method choices listed under "The calculation" are fixed. A reviewer who prefers another reasonable method must adjust the result by hand.
- Attorney, accountant and preparer fees are assumed to be charged the same way as the trustee fees.

**Output**
- Left blank on the forms: lines 25 to 30 (payments and tax due), the election boxes, the foreign country name, the qualified opportunity fund question on Schedule D, and item H on Schedule K-1.
- Amounts are shown to the cent. The filled PDFs remain editable.
- Masking on the displayed source page estimates positions inside a line of text, so a mask can be slightly wide or narrow.

**Questions**
- Answers are limited to 67 excerpts, so many reasonable tax questions are "outside my sources" by design.
- Matching is by keywords. An oddly worded question can miss an excerpt that would have answered it.

**General**
- Nothing is saved. Closing or reloading the tab ends the session, after a warning.
- The AI read depends on a third-party model that can be slow, busy or changed by its provider.
- This is a course prototype. It has not been reviewed by a tax professional and must not be used for a real return.

## Run it, change it, deploy it

**Run locally.** Serve the folder and open the address it prints. Opening `index.html` straight from disk will not work, because browsers block loading the data files that way.

```
python -m http.server
```

**Deploy to GitHub Pages.**

1. Push the repository to GitHub. It must be public on a free account.
2. In the repository, open Settings, then Pages.
3. Under "Build and deployment", choose "Deploy from a branch", branch `main`, folder `/ (root)`, and save.
4. After a minute or two the site is at `https://<user>.github.io/<repository>/`.

There is no build step. The empty `.nojekyll` file tells Pages to serve the files as they are.

**After changing code,** change the version string in `index.html` and `tests/tests.html` (search for `?v=`), so browsers load the new files instead of cached ones.

**After changing an IRS PDF in `sources/`,** run `python scripts/check_excerpts.py`, then `python scripts/list_fields.py` and `python scripts/build_field_map.py`, and review `pdf/FIELD_MAP.md`.

## What is stored where

| Data | Where | For how long |
|---|---|---|
| Returns, documents, answers, results, the log | Memory in the tab | Until the tab closes or reloads |
| Full SSNs and EINs | Memory in the tab, and the PDFs you download | Until the tab closes |
| API key | The tab's `sessionStorage` | Until the tab closes |
| Light or dark theme | `localStorage` | Until you change it |

What leaves the browser: redacted document text and typed questions go to the AI provider when a key is connected. Nothing else is sent anywhere.

## Repository layout

```
index.html                 the app shell: first run, conversation, review, result
styles.css                 light and dark themes
app.js                     interface, conversation flow, review gate, outputs, session state
ai.js                      AI provider adapter, schema validation, SSN/EIN redaction
extract.js                 document reading: classify, parse, AI read, checks, confidence
profile.js                 trust questions, the simple-trust rule, scope and reviewer flags
rules/engine.js            the tax calculation
rules/constants_2025.js    2025 constants, each cited to its IRS page
pdf/fill.js                fills the IRS PDFs; builds the review log PDF and the zip
pdf/field_map_2025.json    return line -> PDF field (FIELD_MAP.md is the readable copy)
pdf/fields/                every field in each IRS PDF
knowledge/irs_excerpts.json  the only text the app may cite
sources/                   the IRS forms and instructions
samples/                   synthetic test documents
scripts/                   make_samples.py, check_excerpts.py, list_fields.py, build_field_map.py
tests/                     tests.html, cases.js, run.js
```

Third-party code, loaded from a CDN at pinned versions: pdf.js 6.2.108 (reads and draws PDFs) and pdf-lib 1.17.1 (fills PDFs). The Inter font loads from Google Fonts. There are no other dependencies.

## Sources

All in `sources/`, from irs.gov: Form 1041 (2025) and its instructions; Schedule K-1 (Form 1041) and its beneficiary instructions; Schedule D (Form 1041) and its instructions; and the instructions for Forms 1099-INT (Rev. January 2024), 1099-DIV (Rev. January 2024) and 1099-B (2025).

## Design decisions

- **Documents first.** The user uploads documents, then answers what they cannot show, as in the approved mockup. This reversed the order in the original build prompt.
- **Scans never go to the AI,** because an image cannot be redacted for SSNs and EINs.
- **Escalating does not unlock.** An undecided fact that the calculation needs keeps Generate locked even after it is escalated.
- **Flash-Lite model by default,** with the model's "thinking" kept to a minimum. Reading printed amounts needs no reasoning, and the larger models were slow and often busy.
- **A stored-only zip** is written by the app itself, so no compression library is needed.
