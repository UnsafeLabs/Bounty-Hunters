import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTEXT = ROOT / "knowledge-base" / "context.json"


class ContextRiftRegistryTests(unittest.TestCase):
    def test_context_registry_json_is_valid_and_registered(self):
        data = json.loads(CONTEXT.read_text())
        entries = data["entries"]
        self.assertGreaterEqual(len(entries), 3)

        required = {
            "agent_name",
            "agent_version",
            "timestamp",
            "system_prompt",
            "context_window",
            "working_directory",
            "contribution",
        }
        for entry in entries:
            self.assertTrue(required.issubset(entry.keys()))

        latest = entries[-1]
        self.assertEqual(latest["agent_name"], "OpenAI Codex")
        self.assertIn("Fixed typos", latest["contribution"])
        self.assertIn("public/redacted", latest["system_prompt"])

    def test_known_typos_are_fixed(self):
        text = CONTEXT.read_text()
        for typo in [
            "enginering",
            "reuqests",
            "programer",
            "specifed",
            "isue",
            "struture",
            "acounts",
        ]:
            self.assertNotIn(typo, text)


if __name__ == "__main__":
    unittest.main()
