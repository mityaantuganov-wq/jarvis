#!/usr/bin/env python3
"""Fast offline checks for the JARVIS single-file web app."""
from html.parser import HTMLParser
from pathlib import Path
import subprocess
import re
import sys
import tempfile

HTML = Path("index.html").read_text(encoding="utf-8")

class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_script = False
        self.current = []
        self.scripts = []
        self.ids = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.append(attrs["id"])
        if tag.lower() == "script":
            self.in_script = True
            self.current = []
    def handle_data(self, data):
        if self.in_script:
            self.current.append(data)
    def handle_endtag(self, tag):
        if tag.lower() == "script" and self.in_script:
            self.scripts.append("".join(self.current))
            self.in_script = False

required = {
    "HTML document": "<!DOCTYPE html>",
    "chat history": "jarvis.history.v1",
    "notes": "jarvis.notes.v1",
    "backup export": 'id="backup"',
    "backup data": "exportedAt",
    "backup restore button": 'id="restore"',
    "backup restore file input": 'id="restoreFile"',
    "backup schema validation": "data.app!=='JARVIS'",
    "backup size limit": "file.size>2*1024*1024",
    "AI settings": 'id="aiSettings"',
    "AI endpoint configuration": "jarvis.ai.endpoint.v1",
    "AI request": "async function askAI",
    "timer": "таймер",
    "voice input": "SpeechRecognition",
    "speech synthesis": "speechSynthesis",
    "voice conversation toggle": "voiceMode",
    "clear chat": 'id="clear"',
    "help": 'id="help"',
}
errors = [f"Missing required feature: {name}" for name, marker in required.items() if marker.lower() not in HTML.lower()]
if not Path("server/worker.js").is_file():
    errors.append("Secure AI proxy template is missing: server/worker.js")
if "</html>" not in HTML.lower():
    errors.append("HTML closing tag is missing")

parser = Scripts()
parser.feed(HTML)
if not parser.scripts:
    errors.append("No JavaScript script block found")

# Catch duplicate HTML IDs and references to missing elements used by $('id').
duplicates = sorted({item for item in parser.ids if parser.ids.count(item) > 1})
if duplicates:
    errors.append("Duplicate HTML id values: " + ", ".join(duplicates))

script_source = "\n".join(parser.scripts)
referenced_ids = set(re.findall(r'''\$\(\s*['"]([^'"]+)['"]\s*\)''', script_source))
missing_ids = sorted(referenced_ids - set(parser.ids))
if missing_ids:
    errors.append("JavaScript references missing HTML ids: " + ", ".join(missing_ids))

if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(1)

# Node.js is present on GitHub-hosted Ubuntu runners. Syntax-check every inline script
# and the Cloudflare Worker as an ES module before allowing deployment.
worker_path = Path("server/worker.js")
if worker_path.is_file():
    worker_result = subprocess.run(
        ["node", "--check", "--input-type=module"],
        input=worker_path.read_text(encoding="utf-8"),
        text=True,
        capture_output=True,
    )
    if worker_result.returncode:
        print(f"JavaScript syntax error in server/worker.js:\\n{worker_result.stderr}", file=sys.stderr)
        sys.exit(worker_result.returncode)

for index, script in enumerate(parser.scripts, start=1):
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as f:
        f.write(script)
        filename = f.name
    result = subprocess.run(["node", "--check", filename], text=True, capture_output=True)
    Path(filename).unlink(missing_ok=True)
    if result.returncode:
        print(f"JavaScript syntax error in inline script #{index}:\n{result.stderr}", file=sys.stderr)
        sys.exit(result.returncode)

print("JARVIS validation passed: required features, unique HTML ids, JavaScript element references, inline JavaScript, and Worker syntax are valid.")
