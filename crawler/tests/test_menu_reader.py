import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import menu_reader  # noqa: E402

# A minimal, hand-built one-page PDF ("Carne Asada Taco 210 Cal" in its content stream) -- no external file,
# so this test never depends on anything outside the repo. Verified against pypdf directly while writing it.
_ONE_PAGE_PDF = (
    b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n"
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n"
    b"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n"
    b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
    b"5 0 obj\n<< /Length 55 >>\nstream\nBT /F1 24 Tf 72 700 Td (Carne Asada Taco 210 Cal) Tj ET\nendstream\nendobj\n"
    b"xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000241 00000 n \n0000000311 00000 n \n"
    b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n416\n%%EOF"
)


class PdfText(unittest.TestCase):
    def test_reads_the_real_text_out_of_a_real_pdf(self):
        self.assertEqual(menu_reader.pdf_text(_ONE_PAGE_PDF), "Carne Asada Taco 210 Cal")

    def test_bytes_that_are_not_a_pdf_give_nothing(self):
        self.assertEqual(menu_reader.pdf_text(b"not a pdf at all"), "")

    def test_empty_bytes_give_nothing(self):
        self.assertEqual(menu_reader.pdf_text(b""), "")

    def test_too_many_pages_gives_nothing_rather_than_a_slow_read(self):
        orig = menu_reader.MAX_PDF_PAGES
        menu_reader.MAX_PDF_PAGES = 0   # the one real page in the fixture is already "too many"
        try:
            self.assertEqual(menu_reader.pdf_text(_ONE_PAGE_PDF), "")
        finally:
            menu_reader.MAX_PDF_PAGES = orig


if __name__ == "__main__":
    unittest.main()
