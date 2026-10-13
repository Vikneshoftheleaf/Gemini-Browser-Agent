# Gemini Live Browser Agent (Chrome extension)

A voice-controlled browser agent. You talk, Gemini 3.1 Flash Live (`gemini-3.1-flash-live-preview`) decides which browser tool to call, and the extension executes it in your real, logged-in Chrome.

## Install

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin the extension and click its icon. The side panel opens.
4. Click the gear, paste your Gemini API key (from https://aistudio.google.com/apikey) and save.
5. Tap the mic. The first time, Chrome opens a tab to ask for microphone access; allow it and tap the mic again.

Requires Chrome 116 or newer (side panel API).

## What it can do (43 tools)

| Area | Tools |
|---|---|
| Tabs and windows | `list_tabs`, `open_tab`, `close_tab`, `switch_tab`, `duplicate_tab`, `reopen_closed_tab`, `group_tabs`, `mute_tab` (mute/pin), `manage_window`, `zoom_page` |
| Navigation and browser data | `navigate`, `search`, `get_history`, `bookmark_page` |
| Seeing | `get_page_snapshot`, `list_frames`, `take_screenshot`, `full_page_screenshot`, `extract_text`, `find_in_page`, `wait_for`, `wait`, `get_console_logs`, `get_network_log` |
| Acting | `click`, `click_at`, `hover`, `drag_and_drop`, `type_text`, `fill_form`, `select_option`, `press_key`, `scroll`, `handle_dialog`, `upload_file` |
| Output | `download_file`, `save_pdf`, `read_clipboard`, `notify_user` |
| Power and system | `run_javascript`, `emulate_device`, `remember`, `schedule_check` |

Tools marked "Needs Trusted input" in their description use Chrome's debugger (CDP): `click_at`, `drag_and_drop`, `handle_dialog`, `upload_file`, `full_page_screenshot`, `save_pdf`, `run_javascript`, `emulate_device`, `get_console_logs`, `get_network_log`. If you turn that setting off they return an error telling the model to ask you to enable it.

You can speak or type. Talking over the model interrupts it.

### Notes on the newer tools

- **Iframes.** `get_page_snapshot` reports when a page has iframes; call it with `includeFrames` to number elements inside them. Refs encode their frame (`ref = slot * 1000 + index`), and the executor routes each action to the right frame. Clicks inside iframes use DOM events rather than trusted input.
- **Coordinates.** `take_screenshot` returns the image size; `click_at` and `drag_and_drop` take coordinates in that image's pixels and convert to page pixels. Coordinate clicks still pass through the approval check by probing what is under the point.
- **Dialogs.** An open `alert/confirm/prompt` freezes the page. The executor detects this, fails fast with a clear message instead of hanging, and the model uses `handle_dialog`.
- **Console and network.** Capture starts on the first call to `get_console_logs` / `get_network_log`, so call once, reproduce the issue, then call again.
- **Memory.** `remember` notes are replayed into the system prompt of future sessions, marked as data. Saving always asks you first, so a web page can't plant instructions.
- **Schedules.** `schedule_check` uses `chrome.alarms`. When one fires and a session is open and idle, the task is sent to Gemini as a message; otherwise you get a desktop notification. The side panel must be open for the agent to act.
- **Emulation** (`emulate_device`) resets when the debugger detaches, which happens when the session ends.

## How it works

```
Mic (16 kHz PCM) ──► Live API WebSocket ◄── screenshots (JPEG frames)
                          │
                          │ toolCall
                          ▼
                     tools.js executor ──► chrome.tabs / chrome.scripting / chrome.debugger
                          │
                          └── toolResponse (JSON) ──► model continues
```

- **Snapshots, not pixels.** `get_page_snapshot` injects a script that numbers every visible interactive element (including inside open shadow DOM). The model acts by `ref`, which is far more reliable than guessing coordinates. Screenshots are there for when layout matters.
- **Trusted input.** With "Trusted input" on, clicks, keys and text go through the Chrome DevTools Protocol, so sites treat them as real user input. Chrome shows a "debugging this browser" bar while this is active. Turn it off to fall back to DOM events.
- **Everything runs in the side panel page.** A service worker would be suspended while idle and drop the WebSocket, so `background.js` only opens the panel.
- **No SDK.** `lib/live.js` speaks the raw WebSocket protocol, so there is nothing to bundle.

## Files

```
manifest.json          MV3 manifest
background.js          opens the side panel, fires scheduled checks
sidepanel.html/css/js  UI, session lifecycle, tool-call loop, approvals
permissions.html/js    one-time microphone permission tab
worklets/capture.js    AudioWorklet: mic -> 16-bit PCM frames
lib/live.js            Live API WebSocket client
lib/audio.js           mic capture + gapless playback + barge-in
lib/tools.js           tool declarations + executor (add new tools here)
lib/page-scripts.js    functions injected into pages
lib/cdp.js             chrome.debugger: trusted input, dialogs, console/network capture, screenshots, PDF
```

## Safety

- **Some tools always ask, even with approvals turned off:** `run_javascript`, `upload_file`, `read_clipboard` and saving with `remember`. They can read local data, run arbitrary code, or persist instructions, so they are never silent.
- **Approvals are enforced in code.** With "Ask before risky actions" on, clicking buttons labelled Buy, Pay, Submit, Send, Delete, Sign out and similar, and typing into password or card-like fields, pauses the tool until you press Allow. The model cannot skip this. Edit `SENSITIVE_CLICK` and `SENSITIVE_FIELD` in `lib/tools.js` to tune it.
- **Prompt injection.** Web pages can contain text that tries to instruct the agent. The system prompt tells the model to treat page content as data, but that is a mitigation, not a guarantee. Keep approvals on, and avoid pointing the agent at sensitive logged-in sessions you would not want automated.
- **API key.** It is stored in `chrome.storage.local` and sent from the browser, which is fine for personal use. For anything you distribute, mint short-lived ephemeral tokens from a small backend instead.
- **Permissions.** The extension requests `<all_urls>`, `tabs`, `scripting` and `debugger` for page control, plus `bookmarks`, `downloads`, `history`, `tabGroups`, `notifications`, `clipboardRead`/`clipboardWrite`, `sessions`, `alarms` and `webNavigation` for the added tools. Remove a permission from `manifest.json` together with its tool if you don't want it. It cannot act on `chrome://` pages or the Chrome Web Store.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not connect" or closes immediately | Check the API key and that the model name in settings is available to your key. Turn off **Long-session mode** (compression and resumption may not be accepted by every model). Set **Thinking** back to "Model default". |
| Mic does nothing | Allow the microphone on the permission tab, then tap the mic again. Check `chrome://settings/content/microphone`. |
| Agent says it can't see the page | The active tab is a restricted page (`chrome://`, Web Store). Ask it to open a normal site. |
| Click lands on the wrong thing | Refs go stale after the page changes. The agent should re-snapshot; remind it in the prompt if it does not. |
| Sites ignore typing | Make sure **Trusted input** is on. |
| Search shows a consent or CAPTCHA page | Edit the URL in the `search` tool (`lib/tools.js`) to use another engine. |

## Extending

Add a declaration to `declarations` and a matching function to `impl` in `lib/tools.js`. Each new Chrome API needs its permission in `manifest.json`. Keep an eye on tool count: 43 tools is fine for Gemini, but every extra declaration adds prompt tokens and a little selection noise, so drop tools you never use.

## Known limits

- Iframes: elements are numbered and can be clicked, typed into and read, but coordinate tools, dragging and uploads don't work inside them. Cross-origin frames the extension can't script (some payment widgets) stay invisible; use `take_screenshot` plus keyboard navigation.
- `drag_and_drop` sends mouse events; native HTML5 drag-and-drop (draggable elements) may not respond.
- `upload_file` needs an absolute local path you give the agent, and doesn't reach file inputs inside shadow roots.
- Native OS dialogs (print, file pickers) are not controllable.
- Clipboard access can fail if the side panel isn't focused; click inside it once and retry.
- Gemini 3.1 Flash Live is a preview model and Google may change or retire it; the model name is editable in settings.
