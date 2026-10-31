from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

import app as cloud
from scripts import build_extension


class SharedServerTests(unittest.TestCase):
    def setUp(self):
        self.client = cloud.app.test_client()
        self.settings = patch.object(cloud.backend, "SETTINGS", {"AUDIO_FOCUS_TOKEN": "relay-test"})
        self.ready = patch.object(cloud.backend, "AI_READY", True)
        self.rate = patch.object(cloud.backend, "rate_limited", return_value=False)
        for mock in (self.settings, self.ready, self.rate):
            mock.start()
            self.addCleanup(mock.stop)

    def test_health_is_public_and_has_no_upstream_credentials(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["authRequired"])
        self.assertNotIn("relay-test", response.text)
        self.assertIn("prompt-alerts", response.json["capabilities"])
        self.assertEqual(self.client.get("/.env").status_code, 404)

    def test_public_relay_rejects_missing_and_invalid_access_tokens(self):
        for headers in ({}, {"X-Demo-Token": "wrong"}):
            self.assertEqual(self.client.post("/check", json={}, headers=headers).status_code, 401)
        self.assertEqual(self.client.post("/check", json={}, headers={"X-Demo-Token": "relay-test"}).status_code, 200)
        with patch.object(cloud.backend, "SETTINGS", {"AUDIO_FOCUS_TOKEN": ""}):
            self.assertEqual(self.client.post("/check", json={}).status_code, 503)

    def test_cors_and_request_validation(self):
        self.assertEqual(self.client.options("/suggest-profile").status_code, 204)
        headers = {"X-Demo-Token": "relay-test"}
        response = self.client.post("/check", json={}, headers=headers)
        self.assertEqual(response.headers["Access-Control-Allow-Origin"], "*")
        self.assertEqual(self.client.post("/check", json=[], headers=headers).status_code, 400)
        self.assertEqual(self.client.post("/check", data="not json", headers=headers).status_code, 400)
        self.assertEqual(self.client.post("/check", data="x" * (cloud.backend.MAX_BODY + 1), headers=headers).status_code, 413)

    def test_cloud_routes_reuse_the_lablup_backend_and_pass_user_preferences(self):
        with patch.dict(cloud.backend.ROUTES, {"/suggest-profile": lambda body: {"request": body["request"]}}):
            response = self.client.post("/suggest-profile", json={"request": "한화 한타"}, headers={"X-Demo-Token": "relay-test"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["request"], "한화 한타")


class SharedBuildTests(unittest.TestCase):
    def test_shareable_zip_contains_relay_access_but_never_the_lablup_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "extension").mkdir()
            source = root / "extension" / "server-config.js"
            source.write_text("local source", encoding="utf-8")
            (root / "extension" / "private-connection.json").write_text("never-copy-this-local-override")
            credentials = root / ".env.shared"
            credentials.write_text("AUDIO_FOCUS_TOKEN=limited-access\nOPENAI_API_KEY=never-include-provider-key\n")
            with patch.object(build_extension, "ROOT", root):
                output = build_extension.build("https://relay.example", credentials)
            with ZipFile(output) as archive:
                text = archive.read("server-config.js").decode()
                self.assertIn("limited-access", text)
                self.assertIn("https://relay.example", text)
                self.assertNotIn("never-include-provider-key", text)
                self.assertEqual(archive.namelist(), ["server-config.js"])
            self.assertEqual(source.read_text(), "local source")


if __name__ == "__main__":
    unittest.main()
