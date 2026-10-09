import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import crawl_places  # noqa: E402
from crawl_places import Api, clean_stale_folders, folder_key, load_env_file, parse_args  # noqa: E402


class FolderKey(unittest.TestCase):
    def test_depends_on_the_place_id_only(self):
        a = folder_key("ChIJN1t_tDeuEmsRUsoyG83frY4")
        self.assertEqual(a, folder_key("ChIJN1t_tDeuEmsRUsoyG83frY4"))
        self.assertNotEqual(a, folder_key("ChIJN1t_tDeuEmsRUsoyG83frY5"))
        self.assertTrue(a.startswith("place-"))

    def test_place_ids_that_differ_only_by_case_get_different_folders(self):
        self.assertNotEqual(folder_key("ChIJabcdefghij"), folder_key("chijabcdefghij"))

    def test_safe_for_use_as_a_folder_name(self):
        self.assertRegex(folder_key("../../etc/passwd"), r"^place-[0-9a-f]{16}$")


class EnvFile(unittest.TestCase):
    def test_reads_key_value_lines_and_never_overrides_the_environment(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "env"
            p.write_text('# comment\nCRAWLER_TEST_A=one\nCRAWLER_TEST_B = "two words"\n\nbad line\nCRAWLER_TEST_C=keepme\n')
            os.environ["CRAWLER_TEST_C"] = "already-set"
            self.addCleanup(lambda: [os.environ.pop(k, None) for k in ("CRAWLER_TEST_A", "CRAWLER_TEST_B", "CRAWLER_TEST_C")])
            load_env_file(str(p))
        self.assertEqual(os.environ["CRAWLER_TEST_A"], "one")
        self.assertEqual(os.environ["CRAWLER_TEST_B"], "two words")
        self.assertEqual(os.environ["CRAWLER_TEST_C"], "already-set")


class CleanStale(unittest.TestCase):
    def test_removes_only_leftover_place_folders(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for name in ("place-aaaa1111aaaa1111", "place-bbbb2222bbbb2222", "notes", "pdfs"):
                (root / name).mkdir()
                (root / name / "page_01.txt").write_text("x")
            (root / "keep.txt").write_text("x")
            self.assertEqual(clean_stale_folders(root), 2)
            left = sorted(p.name for p in root.iterdir())
            self.assertEqual(left, ["keep.txt", "notes", "pdfs"])

    def test_a_missing_folder_is_fine(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(clean_stale_folders(Path(d) / "nope"), 0)


class FakeResponse:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        pass

    def json(self):
        return self._data


class FakeClient:
    def __init__(self, data):
        self.data, self.posts = data, []

    async def post(self, url, json=None, headers=None, timeout=None):
        self.posts.append({"url": url, "json": json, "headers": headers})
        return FakeResponse(self.data)


class ApiTests(unittest.TestCase):
    def test_a_missing_limit_or_job_list_is_handled(self):
        jobs, cap = asyncio.run(Api("u", "s" * 30, "", FakeClient({})).work(5))
        self.assertEqual((jobs, cap), ([], None))

    def test_headers_carry_the_secret_and_optionally_the_anon_key(self):
        self.assertEqual(Api("u", "s" * 30).headers(), {"Content-Type": "application/json", "x-crawler-secret": "s" * 30})
        h = Api("u", "sec", "anon").headers()
        self.assertEqual((h["apikey"], h["Authorization"]), ("anon", "Bearer anon"))

    def test_work_asks_for_a_number_of_jobs_and_returns_them(self):
        client = FakeClient({"jobs": [{"placeId": "P", "name": "N", "link": "https://x.example.com/m"}], "maxPerRun": 50})
        jobs, cap = asyncio.run(Api("https://srv/fn", "sec", "", client).work(3, 7))
        self.assertEqual(jobs[0]["placeId"], "P")
        self.assertEqual(cap, 50)
        self.assertEqual(client.posts[0]["json"], {"action": "work", "limit": 3, "taken": 7})
        self.assertEqual(client.posts[0]["url"], "https://srv/fn")

    def test_result_sends_names_and_text_only_for_ok_and_shortens_the_detail(self):
        client = FakeClient({"status": "ok"})
        api = Api("u", "sec", "", client)
        job = {"placeId": "ChIJabcdefghij", "link": "https://x.example.com/m"}
        asyncio.run(api.result(job, "ok", ["Taco", "Burrito", "Nachos"], "## Mains\n- Taco | 170 Cal", "d" * 500))
        asyncio.run(api.result(job, "error", ["Taco"], "left over text", "timed out"))
        ok_body, err_body = client.posts[0]["json"], client.posts[1]["json"]
        self.assertEqual(ok_body["names"], ["Taco", "Burrito", "Nachos"])
        self.assertEqual(ok_body["text"], "## Mains\n- Taco | 170 Cal")
        self.assertEqual(len(ok_body["detail"]), 300)
        self.assertEqual((ok_body["placeId"], ok_body["link"]), ("ChIJabcdefghij", "https://x.example.com/m"))
        self.assertEqual((err_body["names"], err_body["text"]), ([], ""))
        self.assertEqual(err_body["status"], "error")


class SessionTests(unittest.TestCase):
    def test_a_session_that_was_never_started_closes_cleanly_and_holds_nothing(self):
        from safety import UrlGuard
        session = crawl_places.Session(parse_args([]), UrlGuard())
        self.assertFalse(session.started)
        self.assertIsNone(session.browser)
        self.assertIsNone(session.http)
        asyncio.run(session.close())      # must not raise, and must not try to stop a proxy it never started
        self.assertFalse(session.started)


class ArgsAndLock(unittest.TestCase):
    def test_defaults_are_small_and_safe(self):
        a = parse_args([])
        self.assertEqual((a.limit, a.workers, a.max_pages, a.max_total, a.max_minutes), (5, 1, 6, 0, 240))
        self.assertIsNone(a.try_url)
        self.assertFalse(a.keep)

    def test_a_second_run_cannot_take_the_lock_while_the_first_holds_it(self):
        try:
            import fcntl  # noqa: F401
        except ImportError:
            self.skipTest("no fcntl on this system (the VPS is Linux)")
        with tempfile.TemporaryDirectory() as d:
            path = str(Path(d) / "lock")
            first = crawl_places.acquire_lock(path)
            self.assertTrue(first)
            self.assertIs(crawl_places.acquire_lock(path), False)
            first.close()
            again = crawl_places.acquire_lock(path)
            self.assertTrue(again)
            again.close()


if __name__ == "__main__":
    unittest.main()
