#!/usr/bin/env python3
"""
Local ChatGPT proxy for the Silverpush CTV Failure Prevention Dashboard.
Uses AppleScript to drive Chrome — no API key required.

One-time setup in Chrome:
  View menu → Developer → Allow JavaScript from Apple Events  ✓

Then run:
  python3 chatgpt_proxy.py
"""

import json
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


# ── AppleScript helpers ───────────────────────────────────────────────────────

def osascript(script: str) -> str:
    r = subprocess.run(
        ['osascript', '-e', script],
        capture_output=True, text=True, timeout=30
    )
    return r.stdout.strip()


def chrome_js(tab_idx: int, js: str) -> str:
    """Run JS in a Chrome tab and return the result string."""
    # Flatten to one line and escape for AppleScript string literal
    one_line = js.replace('\n', ' ').replace('\r', '')
    escaped  = one_line.replace('\\', '\\\\').replace('"', '\\"')
    script = f'''tell application "Google Chrome"
    execute tab {tab_idx} of front window javascript "{escaped}"
end tell'''
    return osascript(script)


# ── Core automation ───────────────────────────────────────────────────────────

def ask_chatgpt(prompt: str) -> str:
    # 1. Open a new tab and navigate to ChatGPT
    tab_idx_str = osascript('''tell application "Google Chrome"
    activate
    tell front window
        make new tab
        set URL of active tab to "https://chatgpt.com"
        return count of tabs
    end tell
end tell''')

    try:
        tab_idx = int(tab_idx_str)
    except ValueError:
        raise RuntimeError(f"Could not open Chrome tab. Is Chrome running? ({tab_idx_str})")

    try:
        # 2. Wait for page load
        time.sleep(4)

        # 3. Verify the input exists (catches logged-out state)
        has_input = chrome_js(tab_idx, '''
(function(){
    return document.getElementById("prompt-textarea") ? "yes" : "no";
})()''')

        if has_input != 'yes':
            raise RuntimeError(
                'ChatGPT input box not found. '
                'Make sure you are logged into ChatGPT in Chrome and the page loaded fully.'
            )

        # 4. Type the prompt via execCommand (works on ProseMirror / contenteditable)
        safe_prompt = json.dumps(prompt)  # produces a properly escaped JSON string literal
        result = chrome_js(tab_idx, f'''
(function(){{
    var el = document.getElementById("prompt-textarea");
    el.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("delete",    false, null);
    document.execCommand("insertText",false, {safe_prompt});
    return "typed";
}})()''')

        if result != 'typed':
            raise RuntimeError(f'Could not type into ChatGPT input (got: {result!r})')

        time.sleep(0.4)

        # 5. Click the send button
        chrome_js(tab_idx, '''
(function(){
    var btn = document.querySelector("[data-testid=\\"send-button\\"]");
    if (btn && !btn.disabled) { btn.click(); return "sent"; }
    return "no_button";
})()''')

        # 6. Wait for generation to start
        time.sleep(3)

        # 7. Poll until streaming stops
        response_text = ''
        prev_text     = ''
        stable_rounds = 0

        for _ in range(90):   # up to ~3 minutes
            time.sleep(2)

            generating = chrome_js(tab_idx, '''
(document.querySelector("[data-testid=\\"stop-button\\"]") !== null).toString()''')

            response_text = chrome_js(tab_idx, '''
(function(){
    var msgs = document.querySelectorAll("[data-message-author-role=\\"assistant\\"]");
    if (!msgs.length) return "";
    return msgs[msgs.length - 1].innerText || "";
})()''')

            if generating == 'false' and response_text:
                if response_text == prev_text:
                    stable_rounds += 1
                    if stable_rounds >= 2:
                        break
                else:
                    stable_rounds = 0
                    prev_text = response_text
            else:
                stable_rounds = 0
                prev_text = response_text

        return response_text or 'No response received from ChatGPT.'

    finally:
        # 8. Close the tab (always, even on error)
        osascript(f'''tell application "Google Chrome"
    close tab {tab_idx} of front window
end tell''')


# ── HTTP server ───────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):

    def do_GET(self):
        if self.path == '/health':
            self._respond(200, {'status': 'ok', 'provider': 'chatgpt-chrome'})
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):
        if self.path != '/ask':
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get('Content-Length', 0))
        body   = json.loads(self.rfile.read(length) or b'{}')
        prompt = body.get('prompt', '').strip()

        if not prompt:
            self._respond(400, {'error': 'No prompt provided'})
            return

        print(f'\n[→] Prompt ({len(prompt)} chars): {prompt[:80]}…')
        t0 = time.time()
        try:
            answer = ask_chatgpt(prompt)
            elapsed = time.time() - t0
            print(f'[✓] Done in {elapsed:.1f}s ({len(answer)} chars)')
            self._respond(200, {'answer': answer})
        except Exception as e:
            print(f'[✗] Error: {e}')
            self._respond(500, {'error': str(e)})

    def _respond(self, status: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, *_):
        pass  # silence default access log (we print our own above)


if __name__ == '__main__':
    PORT = 8766
    print('━' * 52)
    print('  Silverpush CTV — ChatGPT Chrome Proxy')
    print('━' * 52)
    print()
    print('One-time Chrome setup (if not done yet):')
    print('  Chrome → View → Developer →')
    print('  ✓  Allow JavaScript from Apple Events')
    print()
    print('Requirements:')
    print('  • Chrome must be open')
    print('  • You must be logged into chatgpt.com in Chrome')
    print()
    print(f'Proxy listening on http://localhost:{PORT}')
    print('Waiting for requests from the dashboard…')
    print()
    HTTPServer(('localhost', PORT), Handler).serve_forever()
