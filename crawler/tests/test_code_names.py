import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from items import (  # noqa: E402
    clean_name, collect_names, collect_text, looks_like_code_name, names_from_json, page_card_names,
)

JUNK = [
    "business-type/business-typequick-service", "customer-stories/logos/caribou-coffee", "hp-features-images/menu-management",
    "rx-logos/mendocino-farms", "orange-right-arrow", "quotation-svg", "menu_photo_2", "logo.png", "hero.JPG", "menu.pdf",
    "https://example.com/menu", "www.example.com", "folder\\file",
]
DISHES = [
    "Crunchy Taco", "Pad Thai", "Coca-Cola", "Mac-n-Cheese", "Chicken Tikka Masala", "Quarter Pounder® with Cheese",
    "7-up", "7-Up", "Egg & Cheese Sandwich", "Pho", "Garlic Naan", "taco",
]


class LooksLikeCodeName(unittest.TestCase):
    def test_flags_paths_slugs_file_names_and_addresses(self):
        for bad in JUNK:
            self.assertTrue(looks_like_code_name(bad), bad)

    def test_keeps_real_dish_names(self):
        for good in DISHES:
            self.assertFalse(looks_like_code_name(good), good)
        self.assertFalse(looks_like_code_name(""))
        self.assertFalse(looks_like_code_name(None))

    def test_clean_name_refuses_code_and_keeps_dishes(self):
        for bad in JUNK:
            self.assertIsNone(clean_name(bad), bad)
        for good in DISHES:
            self.assertEqual(clean_name(good), good)

    def test_names_from_a_data_file_drop_the_junk(self):
        data = {"items": [{"name": n} for n in JUNK + ["Classic Burger", "French Fries"]]}
        self.assertEqual(names_from_json(data), ["Classic Burger", "French Fries"])


class JunkPageIsNotAMenu(unittest.TestCase):
    """A marketing page whose data is full of image paths must not look like a menu."""

    def folder(self, files):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        for name, content in files.items():
            (Path(d.name) / name).write_text(content if isinstance(content, str) else json.dumps(content), encoding="utf-8")
        return d.name

    def test_data_that_is_only_paths_gives_no_names_no_cards_and_no_text_lines(self):
        junk = {"items": [{"name": n} for n in JUNK * 8]}
        f = self.folder({"embedded_01.json": junk})
        self.assertEqual(collect_names(f), [])
        self.assertEqual(page_card_names(f), [])
        self.assertNotIn("- ", collect_text(f))

    def test_cards_on_the_page_count_but_names_from_data_do_not(self):
        f = self.folder({
            "page_01.txt": "SOURCE: x\n\n- Taco | 1 Cal\n- Burrito | 2 Cal\n",
            "api_01.json": {"items": [{"name": "Burrito"}, {"name": "Nachos"}, {"name": "Tamale"}]},
        })
        self.assertEqual(page_card_names(f), ["Taco", "Burrito"])
        # the data names top up a short page, but only valid dish names
        self.assertEqual(collect_names(f), ["Taco", "Burrito", "Nachos", "Tamale"])

    def test_page_card_names_of_an_empty_folder(self):
        self.assertEqual(page_card_names(Path(self.folder({})) / "missing"), [])


if __name__ == "__main__":
    unittest.main()
