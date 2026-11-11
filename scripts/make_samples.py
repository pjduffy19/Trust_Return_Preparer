"""Generate synthetic year-end documents for demos and tests.

Every page is stamped "SAMPLE - SYNTHETIC DATA". Names are fictional and the
identifying numbers use ranges that are never issued (00- EIN prefix, 900- SSN
area). Nothing here is a real IRS form; the layouts only imitate the box labels
so the app has something realistic to read.

Usage:  python scripts/make_samples.py        (needs: pip install reportlab pillow)
Output: samples/<case>/*.pdf
"""
import os
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "samples")
W, H = letter
STAMP = "SAMPLE - SYNTHETIC DATA"


def money(v):
    return f"{v:,.2f}"


def page_frame(c, title, subtitle):
    c.setFillColorRGB(0.72, 0.1, 0.1)
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(W / 2, H - 30, STAMP)
    c.drawCentredString(W / 2, 24, STAMP)
    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(54, H - 64, title)
    c.setFont("Helvetica", 10)
    c.drawString(54, H - 80, subtitle)


def parties(c, payer, payer_tin, recipient, recipient_tin, account):
    c.setFont("Helvetica", 9)
    y = H - 108
    for label, value in [
        ("PAYER'S name", payer),
        ("PAYER'S TIN", payer_tin),
        ("RECIPIENT'S name", recipient),
        ("RECIPIENT'S TIN", recipient_tin),
        ("Account number", account),
    ]:
        c.drawString(54, y, label + ":")
        c.drawString(160, y, value)
        y -= 14
    return y - 10


def box_grid(c, top, boxes, cols=2):
    """Draw boxes like a 1099: the label at the top of the box, the amount below it."""
    bw, bh = (W - 108) / cols, 46
    for i, (label, value) in enumerate(boxes):
        x = 54 + (i % cols) * bw
        y = top - (i // cols) * bh
        c.rect(x, y - bh, bw, bh)
        c.setFont("Helvetica", 8)
        c.drawString(x + 5, y - 12, label)
        if value is not None:
            c.setFont("Helvetica", 11)
            if isinstance(value, str):
                c.drawString(x + 8, y - 32, value)
            else:
                c.drawString(x + 8, y - 32, "$")
                c.drawString(x + 22, y - 32, money(value))
    rows = (len(boxes) + cols - 1) // cols
    return top - rows * bh - 16


def form_1099(path, form, name, payer, boxes, recipient="Maple Street Trust", note=None):
    c = canvas.Canvas(path, pagesize=letter)
    c.setTitle(f"{STAMP} - Form {form}")
    page_frame(c, f"Form {form}", f"{name}   -   Tax year 2025   -   Copy B for recipient")
    y = parties(c, payer, "00-0000001", recipient, "00-0000002", "SAMPLE-0001")
    y = box_grid(c, y, boxes)
    if note:
        c.setFont("Helvetica-Oblique", 9)
        c.drawString(54, y, note)
    c.save()


def int_boxes(b1=0.0, b3=0.0, b4=0.0, b6=0.0, b8=0.0, b9=0.0):
    return [
        ("1 Interest income", b1),
        ("2 Early withdrawal penalty", 0.0),
        ("3 Interest on U.S. Savings Bonds and Treasury obligations", b3),
        ("4 Federal income tax withheld", b4),
        ("5 Investment expenses", 0.0),
        ("6 Foreign tax paid", b6),
        ("8 Tax-exempt interest", b8),
        ("9 Specified private activity bond interest", b9),
    ]


def div_boxes(b1a=0.0, b1b=0.0, b2a=0.0, b4=0.0, b5=0.0, b7=0.0, b12=0.0):
    return [
        ("1a Total ordinary dividends", b1a),
        ("1b Qualified dividends", b1b),
        ("2a Total capital gain distr.", b2a),
        ("3 Nondividend distributions", 0.0),
        ("4 Federal income tax withheld", b4),
        ("5 Section 199A dividends", b5),
        ("7 Foreign tax paid", b7),
        ("12 Exempt-interest dividends", b12),
    ]


def b_boxes(desc, acquired, sold, proceeds, basis, wash=0.0, long_term=True, gain=None):
    lt = "[X] Long-term gain or loss" if long_term else "[ ] Long-term gain or loss"
    st = "[ ] Short-term gain or loss" if long_term else "[X] Short-term gain or loss"
    boxes = [
        ("1a Description of property", desc),
        ("1b Date acquired", acquired),
        ("1c Date sold or disposed", sold),
        ("1d Proceeds", proceeds),
        ("1e Cost or other basis", basis),
        ("1g Wash sale loss disallowed", wash),
        ("2 Type of gain or loss", None),
        ("4 Federal income tax withheld", 0.0),
        (st, None),
        (lt, None),
    ]
    if gain is not None:  # not a 1099-B box; some broker statements print it
        boxes.append(("Realized gain or (loss)", gain))
    return boxes


def summary(path, trust, rows, note):
    c = canvas.Canvas(path, pagesize=letter)
    c.setTitle(f"{STAMP} - trust summary")
    page_frame(c, f"{trust}", "2025 Distribution and Expense Summary   -   prepared by the trustee")
    y = H - 120
    for label, value in rows:
        if value is None:
            c.setFont("Helvetica-Bold", 10)
            c.drawString(54, y, label)
        else:
            c.setFont("Helvetica", 10)
            c.drawString(66, y, label)
            c.drawRightString(W - 60, y, "$" + money(value))
        y -= 18
    c.setFont("Helvetica-Oblique", 9)
    c.drawString(54, y - 10, note)
    c.save()


def prior_return(path, trust, ein, entity, st_loss, lt_loss, beneficiaries, year=2024):
    """A prior-year return in a simplified layout (not the IRS form), with one K-1 page per beneficiary."""
    c = canvas.Canvas(path, pagesize=letter)
    c.setTitle(f"{STAMP} - prior-year Form 1041")
    page_frame(c, "Form 1041", f"U.S. Income Tax Return for Estates and Trusts   -   simplified sample layout, not the IRS form")
    y = H - 112
    c.setFont("Helvetica", 10)
    for label, value in [("Tax year:", str(year)), ("Name of estate or trust:", trust),
                         ("Employer identification number:", ein), ("Name and title of fiduciary:", "Rowan Ashby, Trustee")]:
        c.drawString(54, y, label)
        c.drawString(230, y, value)
        y -= 18
    y -= 8
    c.setFont("Helvetica-Bold", 10)
    c.drawString(54, y, "A  Type of entity")
    y -= 18
    c.setFont("Helvetica", 10)
    c.drawString(66, y, ("[X]" if entity == "simple" else "[ ]") + " Simple trust")
    c.drawString(230, y, ("[X]" if entity == "complex" else "[ ]") + " Complex trust")
    y -= 30
    c.setFont("Helvetica-Bold", 10)
    c.drawString(54, y, f"Schedule D (Form 1041) - carryovers to {year + 1}")
    y -= 18
    c.setFont("Helvetica", 10)
    for label, value in [("Short-term capital loss carryover", st_loss), ("Long-term capital loss carryover", lt_loss)]:
        c.drawString(66, y, label)
        c.drawRightString(W - 60, y, "$" + money(value))
        y -= 18
    c.showPage()
    for i, name in enumerate(beneficiaries):
        page_frame(c, "Schedule K-1 (Form 1041)", f"Beneficiary's Share of Income, Deductions, Credits, etc.   -   {year}   -   simplified sample layout")
        y = H - 112
        c.setFont("Helvetica", 10)
        for label, value in [("Estate's or trust's name:", trust), ("Beneficiary's name:", name),
                             ("Beneficiary's identifying number:", f"900-00-000{i + 1}")]:
            c.drawString(54, y, label)
            c.drawString(230, y, value)
            y -= 18
        c.showPage()
    c.save()


def scanned(path):
    """An image-only page: no text layer, as from a poor scan."""
    from PIL import Image, ImageDraw, ImageFilter
    img = Image.new("L", (850, 1100), 235)
    d = ImageDraw.Draw(img)
    for i, line in enumerate([STAMP, "Form 1099-INT   Interest Income   2025",
                              "1 Interest income      $ 1,850.00",
                              "4 Federal income tax withheld   $ 0.00"]):
        d.text((70, 90 + i * 60), line, fill=40)
    img = img.rotate(2.5, fillcolor=235).filter(ImageFilter.GaussianBlur(1.6))
    c = canvas.Canvas(path, pagesize=letter)
    c.setTitle(f"{STAMP} - scanned")
    c.drawImage(ImageReader(img), 0, 0, W, H)
    c.save()


def main():
    def p(case, name):
        d = os.path.join(OUT, case)
        os.makedirs(d, exist_ok=True)
        return os.path.join(d, name)

    # Case 1: baseline simple trust
    form_1099(p("case1", "1099-INT_HarborRidgeBank.pdf"), "1099-INT", "Interest Income",
              "Harbor Ridge Bank", int_boxes(b1=4000))
    form_1099(p("case1", "1099-DIV_NorthfieldFunds.pdf"), "1099-DIV", "Dividends and Distributions",
              "Northfield Funds", div_boxes(b1a=6000, b1b=4500))
    form_1099(p("case1", "1099-B_CalderBrokerage.pdf"), "1099-B",
              "Proceeds From Broker and Barter Exchange Transactions", "Calder Brokerage",
              b_boxes("200 sh. Northfield Total Market Fund", "03/14/2019", "09/22/2025", 25000, 20000))
    summary(p("case1", "Trust_summary.pdf"), "Maple Street Trust", [
        ("Expenses", None),
        ("Trustee fees (charged to income)", 1200),
        ("Distributions", None),
        ("Income distributed to Avery Maple", 4400),
        ("Income distributed to Jordan Maple", 4400),
        ("Total income distributions", 8800),
        ("Total principal distributions", 0),
    ], "Beneficiaries share income equally. All amounts are made up for testing.")

    # Case 4: tax-exempt interest plus trustee fees
    form_1099(p("case4", "1099-INT_HarborRidgeBank.pdf"), "1099-INT", "Interest Income",
              "Harbor Ridge Bank", int_boxes(b1=4000, b8=2000), recipient="Birchwood Family Trust")
    summary(p("case4", "Trust_summary.pdf"), "Birchwood Family Trust", [
        ("Expenses", None),
        ("Trustee fees (charged to income)", 1200),
        ("Distributions", None),
        ("Total income distributions", 4800),
        ("Total principal distributions", 0),
    ], "All amounts are made up for testing.")

    # Case 6: an unreadable scan
    scanned(p("case6", "1099-INT_scanned.pdf"))

    # Case 7: not the first year - a prior-year return with a capital loss carryover
    prior_return(p("case7", "Prior_year_Form_1041_2024.pdf"), "Maple Street Trust", "00-0000002", "simple",
                 0, 3000, ["Avery Maple", "Jordan Maple"])

    # Extra documents that exercise the checks
    form_1099(p("checks", "1099-DIV_foreign_and_199A.pdf"), "1099-DIV", "Dividends and Distributions",
              "Northfield Funds", div_boxes(b1a=3000, b1b=2000, b5=400, b7=85),
              note="Has foreign tax paid and Section 199A dividends, which the app escalates.")
    form_1099(p("checks", "1099-DIV_inconsistent.pdf"), "1099-DIV", "Dividends and Distributions",
              "Northfield Funds", div_boxes(b1a=1000, b1b=1500),
              note="Deliberately wrong: qualified dividends exceed ordinary dividends.")
    form_1099(p("checks", "1099-B_wash_sale_short_term.pdf"), "1099-B",
              "Proceeds From Broker and Barter Exchange Transactions", "Calder Brokerage",
              b_boxes("50 sh. Calder Growth Fund", "02/03/2025", "06/18/2025", 9000, 9600, wash=250,
                      long_term=False, gain=-350))


if __name__ == "__main__":
    main()
