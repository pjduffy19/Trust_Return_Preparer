"""Build pdf/field_map_2025.json and pdf/FIELD_MAP.md from the field listings.

Usage:  python scripts/build_field_map.py     (run scripts/list_fields.py first; needs `pdftotext`)

Each return line below names a field by its short id in the IRS PDF (for example f1_16). The
script resolves the full field name from pdf/fields/*.json and copies the text printed next to
that field on the form, so every mapping can be checked by eye. A short id that is not in the
listing stops the build: field names are never guessed.
"""
import json, os, re, subprocess
from xml.etree import ElementTree as ET

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FILES = {"f1041": "sources/f1041_2025.pdf", "f1041sd": "sources/f1041sd_2025.pdf", "f1041sk1": "sources/f1041sk1_2025.pdf"}

T, C = "text", "checkbox"
MAP = {
    "f1041": [
        ("trust_name", "f1_4", T, "Name of estate or trust"), ("fiduciary", "f1_5", T, "Name and title of fiduciary"),
        ("street", "f1_6", T, "Number and street"), ("city", "f1_8", T, "City or town"), ("state", "f1_9", T, "State"), ("zip", "f1_11", T, "ZIP code"),
        ("entity_simple", "c1_2", C, "A: Simple trust"), ("entity_complex", "c1_3", C, "A: Complex trust"),
        ("k1_count", "f1_12", T, "B: Number of Schedules K-1 attached"), ("ein", "f1_13", T, "C: Employer identification number"),
        ("date_created", "f1_14", T, "D: Date entity created"),
        ("initial_return", "c1_13", C, "F: Initial return"), ("final_return", "c1_14", C, "F: Final return"), ("amended_return", "c1_15", C, "F: Amended return"),
        ("change_name", "c1_17", C, "F: Change in trust's name"), ("change_fiduciary", "c1_18", C, "F: Change in fiduciary"),
        ("change_fiduciary_name", "c1_19", C, "F: Change in fiduciary's name"), ("change_fiduciary_address", "c1_20", C, "F: Change in fiduciary's address"),
        ("line_1", "f1_16", T, "Line 1: Interest income"), ("line_2a", "f1_17", T, "Line 2a: Total ordinary dividends"),
        ("line_2b1", "f1_18", T, "Line 2b(1): Qualified dividends, beneficiaries"), ("line_2b2", "f1_19", T, "Line 2b(2): Qualified dividends, estate or trust"),
        ("line_4", "f1_21", T, "Line 4: Capital gain or (loss)"), ("line_9", "f1_27", T, "Line 9: Total income"),
        ("line_12", "f1_30", T, "Line 12: Fiduciary fees"), ("line_14", "f1_32", T, "Line 14: Attorney, accountant, and return preparer fees"),
        ("line_16", "f1_35", T, "Line 16: Add lines 10 through 15b"), ("line_17", "f1_36", T, "Line 17: Adjusted total income"),
        ("line_18", "f1_37", T, "Line 18: Income distribution deduction"), ("line_21", "f1_40", T, "Line 21: Exemption"),
        ("line_22", "f1_41", T, "Line 22: Add lines 18 through 21"), ("line_23", "f1_42", T, "Line 23: Taxable income"), ("line_24", "f1_43", T, "Line 24: Total tax"),
        ("schB_1", "f2_8", T, "Schedule B line 1"), ("schB_2", "f2_9", T, "Schedule B line 2"), ("schB_3", "f2_10", T, "Schedule B line 3"),
        ("schB_6", "f2_13", T, "Schedule B line 6"), ("schB_7", "f2_14", T, "Schedule B line 7: Distributable net income"),
        ("schB_8", "f2_15", T, "Schedule B line 8: Accounting income"), ("schB_9", "f2_16", T, "Schedule B line 9"), ("schB_10", "f2_17", T, "Schedule B line 10"),
        ("schB_11", "f2_18", T, "Schedule B line 11"), ("schB_12", "f2_19", T, "Schedule B line 12"), ("schB_13", "f2_20", T, "Schedule B line 13"),
        ("schB_14", "f2_21", T, "Schedule B line 14"), ("schB_15", "f2_22", T, "Schedule B line 15: Income distribution deduction"),
        ("schG_1a", "f2_23", T, "Schedule G line 1a: Tax on taxable income"), ("schG_1e", "f2_27", T, "Schedule G line 1e"),
        ("schG_3", "f2_33", T, "Schedule G line 3"), ("schG_9", "f2_42", T, "Schedule G line 9: Total tax"),
        ("q1_yes", "c3_2[0]", C, "Other Information 1: Yes"), ("q1_no", "c3_2[1]", C, "Other Information 1: No"), ("q1_amount", "f3_13", T, "Other Information 1: tax-exempt amount"),
        ("q2_yes", "c3_3[0]", C, "Other Information 2: Yes"), ("q2_no", "c3_3[1]", C, "Other Information 2: No"),
        ("q3_yes", "c3_4[0]", C, "Other Information 3: Yes"), ("q3_no", "c3_4[1]", C, "Other Information 3: No"),
        ("q4_yes", "c3_5[0]", C, "Other Information 4: Yes"), ("q4_no", "c3_5[1]", C, "Other Information 4: No"),
        ("q5_yes", "c3_6[0]", C, "Other Information 5: Yes"), ("q5_no", "c3_6[1]", C, "Other Information 5: No"),
        ("q9_yes", "c3_10[0]", C, "Other Information 9: Yes"), ("q9_no", "c3_10[1]", C, "Other Information 9: No"),
        ("q10_yes", "c3_11[0]", C, "Other Information 10: Yes"), ("q10_no", "c3_11[1]", C, "Other Information 10: No"),
        ("q11a_no", "c3_12[1]", C, "Other Information 11a: No"), ("q12_no", "c3_14[1]", C, "Other Information 12: No"),
        ("q13_yes", "c3_15[0]", C, "Other Information 13: Yes"), ("q13_no", "c3_15[1]", C, "Other Information 13: No"),
    ],
    "f1041sd": [
        ("trust_name", "f1_01", T, "Name of estate or trust"), ("ein", "f1_02", T, "Employer identification number"),
        ("l1a_d", "f1_03", T, "Line 1a (d) Proceeds"), ("l1a_e", "f1_04", T, "Line 1a (e) Cost"), ("l1a_h", "f1_06", T, "Line 1a (h) Gain or (loss)"),
        ("l6", "f1_21", T, "Line 6: Short-term capital loss carryover"), ("l7", "f1_22", T, "Line 7: Net short-term capital gain or (loss)"),
        ("l8a_d", "f1_23", T, "Line 8a (d) Proceeds"), ("l8a_e", "f1_24", T, "Line 8a (e) Cost"), ("l8a_h", "f1_26", T, "Line 8a (h) Gain or (loss)"),
        ("l13", "f1_41", T, "Line 13: Capital gain distributions"), ("l15", "f1_43", T, "Line 15: Long-term capital loss carryover"),
        ("l16", "f1_44", T, "Line 16: Net long-term capital gain or (loss)"),
        ("l17_1", "f2_01", T, "Line 17 column (1) Beneficiaries"), ("l17_2", "f2_02", T, "Line 17 column (2) Trust"), ("l17_3", "f2_03", T, "Line 17 column (3) Total"),
        ("l18a_1", "f2_04", T, "Line 18a column (1)"), ("l18a_2", "f2_05", T, "Line 18a column (2)"), ("l18a_3", "f2_06", T, "Line 18a column (3)"),
        ("l19_1", "f2_13", T, "Line 19 column (1)"), ("l19_2", "f2_14", T, "Line 19 column (2)"), ("l19_3", "f2_15", T, "Line 19 column (3)"),
        ("l20", "f2_16", T, "Line 20: Capital loss limitation"),
    ] + [("l%d" % n, "f2_%02d" % (n - 4), T, "Part V line %d" % n) for n in range(21, 46)],
    "f1041sk1": [
        ("final_k1", "c1_1[0]", C, "Final K-1"), ("trust_ein", "f1_6", T, "A: Estate's or trust's EIN"), ("trust_name", "f1_7", T, "B: Estate's or trust's name"),
        ("fiduciary_block", "f1_8", T, "C: Fiduciary's name, address, city, state, and ZIP code"),
        ("final_1041", "c1_3", C, "E: Final Form 1041 for the estate or trust"),
        ("ben_tin", "f1_10", T, "F: Beneficiary's identifying number"), ("ben_block", "f1_11", T, "G: Beneficiary's name, address, city, state, and ZIP code"),
        ("box_1", "f1_12", T, "Box 1: Interest income"), ("box_2a", "f1_13", T, "Box 2a: Ordinary dividends"), ("box_2b", "f1_14", T, "Box 2b: Qualified dividends"),
        ("box_3", "f1_15", T, "Box 3: Net short-term capital gain"), ("box_4a", "f1_16", T, "Box 4a: Net long-term capital gain"),
        ("box_14_code", "f1_56", T, "Box 14: Other information, code"), ("box_14_amount", "f1_57", T, "Box 14: Other information, amount"),
    ],
}


def words(pdf):
    xml = subprocess.run(["pdftotext", "-bbox", os.path.join(ROOT, pdf), "-"], capture_output=True, text=True).stdout
    root = ET.fromstring(re.sub(r'xmlns="[^"]+"', "", xml))
    pages = []
    for pg in root.iter("page"):
        h = float(pg.get("height"))
        pages.append([(float(w.get("xMin")), h - float(w.get("yMax")), float(w.get("xMax")), h - float(w.get("yMin")), w.text or "") for w in pg.iter("word")])
    return pages


def nearby(ws, rect):
    x0, y0, x1, y1 = rect
    yc = (y0 + y1) / 2
    row = sorted([w for w in ws if abs((w[1] + w[3]) / 2 - yc) < 5 and w[2] <= x0 + 2 and not re.fullmatch(r"\.+", w[4])], key=lambda w: w[0])
    above = sorted([w for w in ws if 0 < w[1] - y1 + 6 < 16 and x0 - 4 <= w[0] < x1], key=lambda w: (-w[1], w[0]))
    right = sorted([w for w in ws if abs((w[1] + w[3]) / 2 - yc) < 5 and x1 - 2 <= w[0] < x1 + 110], key=lambda w: w[0])
    return {"left": " ".join(w[4] for w in row[-8:]), "above": " ".join(w[4] for w in above[:7]), "right": " ".join(w[4] for w in right[:5])}


def main():
    out, md = {"_about": "Return line -> IRS PDF field. Built by scripts/build_field_map.py from pdf/fields/*.json. 'printed' is the text beside the field on the form."}, ["# Field map (2025)\n",
        "Built by `scripts/build_field_map.py`. The last three columns are the text printed around each field on the IRS form, copied from the PDF so each row can be checked. Header boxes are labelled above the field; numbered lines are labelled to the left; check boxes are labelled to the right.\n"]
    for form, rows in MAP.items():
        listing = json.load(open(os.path.join(ROOT, "pdf", "fields", form + ".json"), encoding="utf-8"))
        ws = words(FILES[form])
        out[form] = {"file": FILES[form], "fields": {}}
        md += ["\n## " + FILES[form] + "\n", "| Return line | PDF field | Type | Printed above the field | Printed to its left | Printed to its right |", "|---|---|---|---|---|---|"]
        for key, short, kind, label in rows:
            suffix = short if short.endswith("]") else short + "[0]"
            hits = [f for f in listing if f["name"].endswith("." + suffix)]
            if len(hits) != 1:
                raise SystemExit(f"{form}: field {short} matched {len(hits)} fields. Not guessing.")
            f = hits[0]
            if f["type"] != kind:
                raise SystemExit(f"{form}: field {short} is a {f['type']}, expected {kind}")
            printed = nearby(ws[f["page"] - 1], f["rect"])
            out[form]["fields"][key] = {"field": f["name"], "type": kind, "label": label, "page": f["page"], "printed": printed}
            md.append(f"| {label} | `{short}` (page {f['page']}) | {kind} | {printed['above'][:60]} | {printed['left'][-70:]} | {printed['right'][:40]} |")
    json.dump(out, open(os.path.join(ROOT, "pdf", "field_map_2025.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    open(os.path.join(ROOT, "pdf", "FIELD_MAP.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")
    print("field map written:", {k: len(v["fields"]) for k, v in out.items() if k != "_about"})


if __name__ == "__main__":
    main()
