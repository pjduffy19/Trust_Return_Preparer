"""Check that every excerpt in knowledge/irs_excerpts.json really appears in its source PDF.

Usage:  python scripts/check_excerpts.py      (needs the `pdftotext` command, from poppler)
An excerpt may join separate passages with " […] " or list separate labels with " · ";
each piece is checked on its own. Whitespace, bullets and dot leaders are ignored.
"""
import json, os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def norm(s):
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"[••]", " ", s)
    s = re.sub(r"(\s*\.){3,}", " ", s)          # dot leaders on forms
    return re.sub(r"\s+", " ", s).strip().lower()


def main():
    data = json.load(open(os.path.join(ROOT, "knowledge", "irs_excerpts.json"), encoding="utf-8"))
    texts, bad = {}, 0
    for e in data["excerpts"]:
        f = e["file"]
        if f not in texts:
            raw = subprocess.run(["pdftotext", os.path.join(ROOT, f), "-"], capture_output=True, text=True).stdout
            texts[f] = norm(raw)
        for piece in re.split(r"\s*\[…\]\s*|\s+·\s+", e["text"]):
            if piece and norm(piece) not in texts[f]:
                bad += 1
                print(f"NOT FOUND  {e['id']}: {piece[:90]}")
    print(f"{len(data['excerpts'])} excerpts checked, {bad} piece(s) not found")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
