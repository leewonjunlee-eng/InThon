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

    def test_judge_alerts_only_with_evidence_found_in_the_spoken_record(self):
        text = "[10:01] 한화가 드래곤 앞에서 한타를 열었습니다\n(소리 변화: 함성이나 고함 급등)"
        for evidence, expected in (("[10:01] 드래곤 앞에서 한타를", True), ("바론을 처치했습니다", False), ("(소리 변화: 함성이나 고함 급등)", False), ("", False)):
            with patch.object(server, "ask_json", return_value={"important": True, "evidence": evidence}):
                self.assertEqual(server.judge({"condition": "한타", "text": text})["important"], expected, evidence)

    def test_user_preference_is_separate_from_untrusted_page_context(self):
        answer = {"name": "한화 경기", "rules": [{"text": "한화 경기 중 한타가 발생하면"}]}
        with patch.object(server, "ask_json", return_value=answer) as model:
            server.suggest_profile({"title": "스위스 스테이지 Day 7 | 2026 월드 챔피언십",
                                    "request": "한화 갱킹과 한타만 알려줘. 일정 제외."})
        import json
        context = json.loads(model.call_args.args[1])
        self.assertEqual(context["request"], "한화 갱킹과 한타만 알려줘. 일정 제외.")
        self.assertIn("가장 우선", model.call_args.args[0])
        self.assertIn("모든 조건에 그 범위", model.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
