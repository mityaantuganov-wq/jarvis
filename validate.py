#!/usr/bin/env python3
"""Fast offline checks for the JARVIS single-file web app."""
from html.parser import HTMLParser
from pathlib import Path
import subprocess
import sys
import tempfile

HTML = Path("index.html").read_text(encoding="utf-8")

class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_script = False
        self.current = []
        self.scripts = []
    def handle_starttag(self, tag, attrs):
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
    "timer": "таймер",
    "voice input": "SpeechRecognition",
    "speech synthesis": "speechSynthesis",
    "voice conversation toggle": "voiceMode",
    "clear chat": 'id="clear"',
    "help": 'id="help"',
}
errors = [f"Missing required feature: {name}" for name, marker in required.items() if marker.lower() not in HTML.lower()]
if "</html>" not in HTML.lower():
    errors.append("HTML closing tag is missing")

parser = Scripts()
parser.feed(HTML)
if not parser.scripts:
    errors.append("No JavaScript script block found")

if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(1)

# Node.js is present on GitHub-hosted Ubuntu runners. Syntax-check every inline script.
for index, script in enumerate(parser.scripts, start=1):
    with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as f:
        f.write(script)
        filename = f.name
    result = subprocess.run(["node", "--check", filename], text=True, capture_output=True)
    Path(filename).unlink(missing_ok=True)
    if result.returncode:
        print(f"JavaScript syntax error in inline script #{index}:\n{result.stderr}", file=sys.stderr)
        sys.exit(result.returncode)

print("JARVIS validation passed: required features present and inline JavaScript syntax is valid.")
