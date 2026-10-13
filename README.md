<p align="center">
  <img src="icons/icon128.png" width="80" alt="Gemini Live Browser Agent icon" />
</p>

<h1 align="center">Gemini Live Browser Agent</h1>

<p align="center">
  A voice-controlled browser agent powered by the Gemini Live API.<br/>
  Talk to your browser — Gemini decides what to do, the extension does it.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="MV3"/>
  <img src="https://img.shields.io/badge/Chrome-116+-34A853?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome 116+"/>
  <img src="https://img.shields.io/badge/Gemini%20Live%20API-8E44AD?style=flat-square&logo=google&logoColor=white" alt="Gemini Live API"/>
  <img src="https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript"/>
  <img src="https://img.shields.io/badge/WebSocket-raw-00ADB5?style=flat-square" alt="WebSocket"/>
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License"/>
</p>

---

## ✨ What it does

Speak a command → Gemini figures out which of **43 browser tools** to call → the extension executes it in your real, logged-in Chrome.

- 🎙️ **Voice + text input** — interrupt the model mid-sentence
- 🧠 **Snapshot-based vision** — numbers every interactive element on the page (no coordinate guessing)
- 🔒 **Built-in approval gates** — risky actions (Buy, Delete, Pay…) always ask first
- 🗓️ **Scheduled tasks** — set recurring checks via `chrome.alarms`
- 💾 **Persistent memory** — notes survive across sessions

---

## 🚀 Quick Start

> **Requires Chrome 116+** and a [Gemini API key](https://aistudio.google.com/apikey).

1. **Download this project as ZIP** and extract the folder.
2. Go to `chrome://extensions` → enable **Developer mode**
3. Click **Load unpacked** → select this folder
4. Pin the extension and click its icon to open the side panel
5. Click **⚙ Settings** → paste your Gemini API key → Save
6. Tap the **🎤 mic** — on first use, allow microphone access when prompted

---

## 🛠️ Tools (43 total)

| Category | Tools |
|---|---|
| **Tabs & Windows** | `list_tabs` `open_tab` `close_tab` `switch_tab` `duplicate_tab` `reopen_closed_tab` `group_tabs` `mute_tab` `manage_window` `zoom_page` |
| **Navigation** | `navigate` `search` `get_history` `bookmark_page` |
| **Seeing** | `get_page_snapshot` `list_frames` `take_screenshot` `full_page_screenshot` `extract_text` `find_in_page` `wait_for` `wait` `get_console_logs` `get_network_log` |
| **Acting** | `click` `click_at` `hover` `drag_and_drop` `type_text` `fill_form` `select_option` `press_key` `scroll` `handle_dialog` `upload_file` |
| **Output** | `download_file` `save_pdf` `read_clipboard` `notify_user` |
| **Power** | `run_javascript` `emulate_device` `remember` `schedule_check` |

> Tools using CDP (Chrome DevTools Protocol) require **Trusted Input** to be enabled: `click_at`, `drag_and_drop`, `handle_dialog`, `upload_file`, `full_page_screenshot`, `save_pdf`, `run_javascript`, `emulate_device`, `get_console_logs`, `get_network_log`.

---

## 🏗️ Architecture

```
Mic (16 kHz PCM) ──► Live API WebSocket ◄── screenshots (JPEG frames)
                          │
                          │  toolCall
                          ▼
                     tools.js executor ──► chrome.tabs / chrome.scripting / chrome.debugger
                          │
                          └── toolResponse (JSON) ──► model continues
```

**Key design decisions:**

- **Snapshots over pixels** — `get_page_snapshot` numbers every visible interactive element (including shadow DOM). The model acts on stable `ref` IDs.
- **No SDK** — `lib/live.js` speaks the raw WebSocket protocol. Nothing to bundle.
- **Side panel, not service worker** — avoids WebSocket drops from idle suspension.
- **Trusted input** — clicks and keystrokes go through CDP so sites treat them as real user input.

---

## 📁 Project Structure

```
├── manifest.json          MV3 manifest
├── background.js          Opens the side panel, fires scheduled checks
├── sidepanel.html/css/js  UI, session lifecycle, tool-call loop, approvals
├── permissions.html/js    One-time microphone permission tab
├── worklets/
│   └── capture.js         AudioWorklet: mic → 16-bit PCM frames
└── lib/
    ├── live.js             Live API WebSocket client
    ├── audio.js            Mic capture + gapless playback + barge-in
    ├── tools.js            Tool declarations + executor (add new tools here)
    ├── page-scripts.js     Functions injected into pages
    └── cdp.js              Trusted input, dialogs, console/network, screenshots, PDF
```

---

## 🔐 Security & Safety

- **Always-ask tools:** `run_javascript`, `upload_file`, `read_clipboard`, and `remember` — these can read local data or persist instructions and are never silently executed.
- **Approval gates:** Sensitive clicks (Buy, Pay, Submit, Delete…) and sensitive fields (password, card) pause for user confirmation. Edit `SENSITIVE_CLICK` / `SENSITIVE_FIELD` in `lib/tools.js` to tune.
- **API key:** Stored in `chrome.storage.local` — fine for personal use. For distribution, use short-lived ephemeral tokens from a backend.
- **Prompt injection:** The system prompt instructs the model to treat page content as data — but keep approvals on when browsing sensitive sessions.

---

## 🐛 Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not connect" | Check API key; disable Long-session mode; reset Thinking to "Model default" |
| Mic does nothing | Allow microphone on the permission tab; check `chrome://settings/content/microphone` |
| Can't see the page | Active tab is a restricted page (`chrome://`, Web Store) — navigate to a normal site |
| Clicks land wrong | Re-snapshot after page changes; remind the agent if needed |
| Typing is ignored | Enable **Trusted Input** in settings |

---

## 🧩 Extending

Add a declaration to `declarations` and a matching handler to `impl` in [`lib/tools.js`](lib/tools.js). New Chrome APIs also need their permission added to [`manifest.json`](manifest.json).

> Keep tool count in mind — 43 tools is fine for Gemini, but every extra declaration adds prompt tokens. Remove tools you never use.

---

## ⚠️ Known Limits

- Coordinate tools, drag, and uploads don't work **inside iframes**
- `drag_and_drop` uses mouse events — native HTML5 draggable elements may not respond
- `upload_file` needs an absolute local path and doesn't reach file inputs inside shadow roots
- Native OS dialogs (print, file pickers) are not controllable
- Clipboard access may fail if the side panel isn't focused — click inside it first
- `gemini-3.1-flash-live-preview` is a preview model — the model name is editable in Settings

---

## 🤝 Contributing

Contributions are welcome! Please open an issue to discuss major changes before submitting a PR.

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'feat: add my feature'`
4. Push and open a Pull Request

---

## 📄 License

[MIT](LICENSE) © 2026 Viknesh

