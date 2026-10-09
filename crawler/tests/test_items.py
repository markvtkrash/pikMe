import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from items import (  # noqa: E402
    MAX_NAMES, TEXT_LIMIT, clean_name, collect_names, collect_text, decide_status, names_from_json, names_from_menu_text,
)


class CleanName(unittest.TestCase):
    def test_keeps_a_real_dish_name(self):
        self.assertEqual(clean_name("Classic Burger"), "Classic Burger")
        self.assertEqual(clean_name("  Quarter Pounder® with Cheese "), "Quarter Pounder® with Cheese")

    def test_strips_prices_calories_and_edge_punctuation(self):
        self.assertEqual(clean_name("Big Mac $5.99"), "Big Mac")
        self.assertEqual(clean_name("- Fries 320 Cal."), "Fries")
        self.assertEqual(clean_name("• Chicken Wrap |"), "Chicken Wrap")

    def test_rejects_things_that_are_not_dish_names(self):
        for raw in ("", " ", "$5.99", "550 Cal", "12", "A", "NEW", "Order Now", "Popular", "x" * 81, None, 42, ["a"]):
            self.assertIsNone(clean_name(raw), repr(raw)[:30])


class NamesFromMenuText(unittest.TestCase):
    TEXT = (
        "## Burgers\n"
        "- Classic Burger | 550 Cal | Beef, lettuce\n"
        "- Double Burger | $9.99\n"
        "\n"
        "Categories: Burgers, Sides\n"
        "## Sides\n"
        "- Fries | 320 Cal\n"
        "- NEW | Spicy Wings | 400 Cal\n"
        "not a card line | 1 Cal\n"
    )

    def test_reads_the_name_part_of_each_card_only(self):
        self.assertEqual(names_from_menu_text(self.TEXT), ["Classic Burger", "Double Burger", "Fries"])

    def test_empty_input(self):
        self.assertEqual(names_from_menu_text(""), [])
        self.assertEqual(names_from_menu_text(None), [])


class NamesFromJson(unittest.TestCase):
    def test_reads_item_names(self):
        data = {"source": "x", "items": [{"name": "Taco"}, {"name": "$4"}, {"title": "no name key"}, "bad", {"name": "Burrito"}]}
        self.assertEqual(names_from_json(data), ["Taco", "Burrito"])

    def test_wrong_shapes(self):
        for data in (None, [], {"items": "x"}, {"items": None}, 5):
            self.assertEqual(names_from_json(data), [])


class CollectNames(unittest.TestCase):
    def folder(self, files):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        for name, content in files.items():
            (Path(d.name) / name).write_text(content if isinstance(content, str) else json.dumps(content), encoding="utf-8")
        return d.name

    def test_page_text_is_used_and_duplicates_across_pages_are_dropped(self):
        f = self.folder({
            "page_01.txt": "SOURCE: a\n\n- Taco | 1 Cal\n- Burrito | 2 Cal\n- Nachos | 3 Cal\n- Quesadilla | 4 Cal\n- Tamale | 5 Cal\n",
            "page_02.txt": "SOURCE: b\n\n- taco | 1 Cal\n- Churros | 9 Cal\n",
        })
        self.assertEqual(collect_names(f), ["Taco", "Burrito", "Nachos", "Quesadilla", "Tamale", "Churros"])

    def test_json_only_tops_up_a_page_with_very_few_names(self):
        few = self.folder({"page_01.txt": "- Taco | 1 Cal\n", "api_01.json": {"items": [{"name": "Burrito"}, {"name": "Nachos"}]}})
        self.assertEqual(collect_names(few), ["Taco", "Burrito", "Nachos"])
        plenty = self.folder({
            "page_01.txt": "".join(f"- Dish {i} | 1 Cal\n" for i in range(6)),
            "api_01.json": {"items": [{"name": "Modifier Extra Cheese"}]},
        })
        self.assertNotIn("Modifier Extra Cheese", collect_names(plenty))

    def test_json_alone_is_used_when_there_is_no_page_text(self):
        f = self.folder({"embedded_01.json": {"items": [{"name": "Pho"}, {"name": "Banh Mi"}, {"name": "Spring Rolls"}]}})
        self.assertEqual(collect_names(f), ["Pho", "Banh Mi", "Spring Rolls"])

    def test_caps_the_list_and_survives_a_missing_folder_or_bad_files(self):
        big = self.folder({"page_01.txt": "".join(f"- Dish number {i} | 1 Cal\n" for i in range(MAX_NAMES + 40))})
        self.assertEqual(len(collect_names(big)), MAX_NAMES)
        self.assertEqual(collect_names(Path(big) / "does-not-exist"), [])
        broken = self.folder({"api_01.json": "{not json"})
        self.assertEqual(collect_names(broken), [])


class CollectText(unittest.TestCase):
    def folder(self, files):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        for name, content in files.items():
            (Path(d.name) / name).write_text(content if isinstance(content, str) else json.dumps(content), encoding="utf-8")
        return d.name

    def test_joins_the_pages_without_header_lines_and_repeats(self):
        f = self.folder({
            "page_01.txt": "SOURCE: https://a.example.com/menu\n\n## Mains\n- Taco | 170 Cal\n- Burrito | 300 Cal\n"
                           "- Nachos | 450 Cal\n- Tamale | 200 Cal\n- Flan | 250 Cal\n",
            "page_02.txt": "SOURCE: https://a.example.com/more\n\n## Mains\n- Taco | 170 Cal\n## Sides\n- Rice | 120 Cal\n",
        })
        text = collect_text(f)
        self.assertNotIn("SOURCE:", text)
        self.assertEqual(text.count("- Taco | 170 Cal"), 1)
        self.assertEqual(text.count("## Mains"), 1)
        self.assertIn("## Sides", text)
        self.assertIn("- Rice | 120 Cal", text)

    def test_page_data_names_are_added_only_when_the_pages_gave_few_menu_lines(self):
        few = self.folder({"page_01.txt": "- Taco | 170 Cal\n", "api_01.json": {"items": [{"name": "Burrito"}, {"name": "Nachos"}]}})
        text = collect_text(few)
        self.assertIn("## Data found in the page code", text)
        self.assertIn("- Burrito", text)
        many = self.folder({
            "page_01.txt": "".join(f"- Dish {i} | 1 Cal\n" for i in range(6)),
            "api_01.json": {"items": [{"name": "Modifier Extra Cheese"}]},
        })
        self.assertNotIn("Modifier Extra Cheese", collect_text(many))

    def test_is_cut_at_a_line_boundary_within_the_limit(self):
        f = self.folder({"page_01.txt": "".join(f"- Dish number {i} | {i} Cal\n" for i in range(9000))})
        text = collect_text(f)
        self.assertLessEqual(len(text), TEXT_LIMIT)
        self.assertGreater(len(text), TEXT_LIMIT - 100)
        self.assertTrue(text.splitlines()[-1].endswith(" Cal"))
        self.assertLessEqual(len(collect_text(f, limit=100)), 100)

    def test_empty_when_there_is_nothing(self):
        self.assertEqual(collect_text(self.folder({})), "")
        self.assertEqual(collect_text(Path(self.folder({})) / "missing"), "")


class DecideStatus(unittest.TestCase):
    def manifest(self, results, errors=()):
        return {"visited": [{"result": r} for r in results], "errors": list(errors), "menu_pages": 1}

    def test_three_or_more_dishes_is_ok(self):
        status, detail = decide_status(["a1", "b2", "c3"], self.manifest(["menu found"]))
        self.assertEqual(status, "ok")
        self.assertIn("3 dishes", detail)

    def test_pages_read_but_no_dish_list_is_no_items(self):
        status, _ = decide_status(["a1"], self.manifest(["no menu on page", "no menu on page"]))
        self.assertEqual(status, "no_items")
        self.assertEqual(decide_status([], self.manifest(["menu found"]))[0], "no_items")

    def test_no_page_could_be_read_is_an_error_worth_retrying(self):
        status, detail = decide_status([], self.manifest(["HTTP 403", "page timed out after 90s"]))
        self.assertEqual(status, "error")
        self.assertIn("HTTP 403", detail)
        self.assertEqual(decide_status([], self.manifest([], ["Site blocks both the automated browser and plain requests"]))[0], "error")
        self.assertEqual(decide_status([], {"visited": [], "errors": []})[0], "error")

    def test_a_mix_where_one_page_was_read_counts_as_read(self):
        self.assertEqual(decide_status([], self.manifest(["HTTP 404", "no menu on page"]))[0], "no_items")


if __name__ == "__main__":
    unittest.main()
