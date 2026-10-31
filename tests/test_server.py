import unittest
from unittest.mock import patch
from server import server


class SuggestProfileTests(unittest.TestCase):
    def test_context_is_bounded_and_rules_are_cleaned(self):
        answer = {"name": "판매 방송", "rules": [
            {"text": " 가격이 공개되면 ", "enabled": False},
            {"text": " "}, {"text": 123}, "invalid",
        ]}
        with patch.object(server, "ask_json", return_value=answer) as model:
            result = server.suggest_profile({"title": "x" * 500, "host": "example.com", "text": "y" * 8000,
                                             "description": "설명" * 2000, "pageText": "본문" * 3000, "captions": "현재 자막"})
        self.assertEqual(result["rules"], [{"text": "가격이 공개되면", "enabled": True}])
        self.assertEqual(model.call_args.kwargs["max_tokens"], 5000)
        import json
        context = json.loads(model.call_args.args[1])
        self.assertEqual(len(context["title"]), 300)
        self.assertEqual(len(context["text"]), 6000)
        self.assertEqual(len(context["description"]), 1500)
        self.assertEqual(len(context["pageText"]), 3500)
        self.assertEqual(context["captions"], "현재 자막")

    def test_invalid_model_output_is_rejected(self):
        for answer in ([], {"rules": []}, {"rules": "invalid"}):
            with self.subTest(answer=answer), patch.object(server, "ask_json", return_value=answer):
                with self.assertRaises(ValueError):
                    server.suggest_profile({"title": "test"})

    def test_enabled_conditions_are_not_truncated_to_the_old_300_character_limit(self):
        with patch.object(server, "ask_json", return_value={"important": False}) as model:
            server.judge({"condition": "조건" * 600, "text": "예시 자막"})
        self.assertIn("조건" * 600, model.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
