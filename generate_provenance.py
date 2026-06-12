import json
import datetime
import os

with open("/Users/ishantpanchal/.gemini/antigravity-cli/brain/bcf5bb79-4384-4ef6-b893-0cb81c732fde/submission_standard.md", "r") as f:
    standard_text = f.read()

config_snapshot = "GodMode Rules and Instructions:\n" + standard_text

data = {
    "agent_name": "Antigravity",
    "config_snapshot": config_snapshot,
    "created": datetime.datetime.now(datetime.UTC).isoformat() + "Z"
}

with open("t3code/apps/web/src/.provenance.json", "w") as f:
    json.dump(data, f, indent=2)

