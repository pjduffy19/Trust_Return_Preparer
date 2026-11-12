"""List every AcroForm field in the IRS fillable PDFs, with its name, type, tooltip and position.

Usage:  python scripts/list_fields.py            (needs: pip install pypdf)
Output: pdf/fields/<form>.json, one entry per field, in page order then top-to-bottom.
The field map in pdf/field_map_2025.json is built from these listings, never from guessed names.
"""
import json, os
from pypdf import PdfReader

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FORMS = {"f1041": "sources/f1041_2025.pdf", "f1041sd": "sources/f1041sd_2025.pdf", "f1041sk1": "sources/f1041sk1_2025.pdf"}


def full_name(annot):
    parts, node = [], annot
    while node is not None:
        if "/T" in node:
            parts.append(str(node["/T"]))
        node = node.get("/Parent").get_object() if "/Parent" in node else None
    return ".".join(reversed(parts))


def inherited(annot, key):
    node = annot
    while node is not None:
        if key in node:
            return node[key]
        node = node.get("/Parent").get_object() if "/Parent" in node else None
    return None


def list_fields(path):
    out = []
    reader = PdfReader(path)
    for page_no, page in enumerate(reader.pages, start=1):
        for ref in page.get("/Annots", []) or []:
            a = ref.get_object()
            if a.get("/Subtype") != "/Widget":
                continue
            ft = inherited(a, "/FT")
            rect = [round(float(v), 1) for v in a["/Rect"]]
            entry = {"page": page_no, "name": full_name(a), "type": {"/Tx": "text", "/Btn": "checkbox", "/Ch": "choice"}.get(str(ft), str(ft)),
                     "tooltip": str(inherited(a, "/TU") or ""), "rect": rect}
            if ft == "/Btn" and "/AP" in a and "/N" in a["/AP"]:
                entry["on"] = [k[1:] for k in a["/AP"]["/N"].keys() if k != "/Off"]
            ml = inherited(a, "/MaxLen")
            if ml is not None:
                entry["maxLen"] = int(ml)
            out.append(entry)
    out.sort(key=lambda e: (e["page"], -e["rect"][3], e["rect"][0]))
    return out


if __name__ == "__main__":
    os.makedirs(os.path.join(ROOT, "pdf", "fields"), exist_ok=True)
    for key, rel in FORMS.items():
        fields = list_fields(os.path.join(ROOT, rel))
        with open(os.path.join(ROOT, "pdf", "fields", key + ".json"), "w", encoding="utf-8") as f:
            json.dump(fields, f, ensure_ascii=False, indent=1)
        print(f"{key}: {len(fields)} fields")
