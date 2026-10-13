// Tool declarations (what Gemini can call) and the executor (what actually runs).
// 43 tools. Group overview:
//   tabs/windows  list_tabs open_tab close_tab switch_tab duplicate_tab reopen_closed_tab group_tabs
//                 mute_tab manage_window zoom_page
//   navigation    navigate search get_history bookmark_page
//   seeing        get_page_snapshot list_frames take_screenshot full_page_screenshot extract_text
//                 find_in_page wait_for wait get_console_logs get_network_log
//   acting        click click_at hover drag_and_drop type_text fill_form select_option press_key scroll
//                 handle_dialog upload_file
//   output        download_file save_pdf read_clipboard notify_user
//   power/system  run_javascript emulate_device remember schedule_check

import * as P from "./page-scripts.js";
import * as cdp from "./cdp.js";
import { bytesToBase64, base64ToBytes } from "./audio.js";

const S = (description, extra = {}) => ({ type: "STRING", description, ...extra });
const N = (description) => ({ type: "INTEGER", description });
const F = (description) => ({ type: "NUMBER", description });
const B = (description) => ({ type: "BOOLEAN", description });
const obj = (properties, required = []) => ({ type: "OBJECT", properties, required });

export const declarations = [
  // ---- tabs and windows ----------------------------------------------------
  { name: "list_tabs", description: "List all open tabs with id, title, url and which one is active." },
  {
    name: "open_tab",
    description: "Open a URL in a new tab and make it the working tab.",
    parameters: obj({ url: S("Full URL or domain, e.g. https://example.com"), active: B("Focus the new tab. Default true.") }, ["url"]),
  },
  {
    name: "close_tab",
    description: "Close a tab. If tabId is omitted, closes the current working tab.",
    parameters: obj({ tabId: N("Tab id from list_tabs") }),
  },
  {
    name: "switch_tab",
    description: "Focus a tab and make it the working tab.",
    parameters: obj({ tabId: N("Tab id from list_tabs") }, ["tabId"]),
  },
  {
    name: "duplicate_tab",
    description: "Duplicate a tab (current one by default) and switch to the copy.",
    parameters: obj({ tabId: N("Tab id to duplicate") }),
  },
  {
    name: "reopen_closed_tab",
    description: "Restore a recently closed tab (the most recent by default), or list recently closed tabs and windows.",
    parameters: obj({ action: S("What to do", { enum: ["restore", "list"] }), sessionId: S("Session id from a previous list") }),
  },
  {
    name: "group_tabs",
    description: "Organise tabs into named, coloured groups; list groups; update or remove groups.",
    parameters: obj(
      {
        action: S("What to do", { enum: ["group", "ungroup", "list", "update"] }),
        tabIds: { type: "ARRAY", items: { type: "INTEGER" }, description: "Tabs to group or ungroup. Defaults to the current tab." },
        groupId: N("Existing group id to add to or update"),
        title: S("Group name"),
        color: S("Group colour", { enum: ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"] }),
        collapsed: B("Collapse the group"),
      },
      ["action"]
    ),
  },
  {
    name: "mute_tab",
    description: "Mute, unmute, pin or unpin a tab.",
    parameters: obj(
      { action: S("What to do", { enum: ["mute", "unmute", "pin", "unpin"] }), tabId: N("Defaults to the current tab") },
      ["action"]
    ),
  },
  {
    name: "manage_window",
    description: "List, create (normal or incognito), resize, maximise, minimise, fullscreen, focus or close browser windows.",
    parameters: obj(
      {
        action: S("What to do", { enum: ["list", "new", "new_incognito", "resize", "maximize", "minimize", "fullscreen", "restore", "focus", "close"] }),
        windowId: N("Target window. Defaults to the working tab's window."),
        url: S("URL for new windows"),
        width: N("Pixels, for new or resize"),
        height: N("Pixels, for new or resize"),
        left: N("Pixels from the left, for resize"),
        top: N("Pixels from the top, for resize"),
      },
      ["action"]
    ),
  },
  {
    name: "zoom_page",
    description: "Zoom the current tab in, out, to an exact factor, or back to default.",
    parameters: obj({ action: S("What to do", { enum: ["in", "out", "reset", "set"] }), factor: F("0.25 to 5, used with action set") }, ["action"]),
  },

  // ---- navigation and browser data ------------------------------------------
  {
    name: "navigate",
    description: "Navigate the current tab: go to a URL, go back, go forward, or reload.",
    parameters: obj(
      { action: S("What to do", { enum: ["goto", "back", "forward", "reload"] }), url: S("Required when action is goto") },
      ["action"]
    ),
  },
  {
    name: "search",
    description: "Search the web with Google, in the current tab or a new tab.",
    parameters: obj({ query: S("Search query"), newTab: B("Open results in a new tab. Default false.") }, ["query"]),
  },
  {
    name: "get_history",
    description: "Search the user's browsing history (for 'that article I read yesterday').",
    parameters: obj({ query: S("Text to match in title or URL. Empty returns the most recent."), days: N("How far back. Default 7."), maxResults: N("Default 10.") }),
  },
  {
    name: "bookmark_page",
    description: "Add the current page (or a URL) to bookmarks, search bookmarks, list recent ones, or remove a bookmark.",
    parameters: obj(
      {
        action: S("What to do", { enum: ["add", "search", "list", "remove"] }),
        query: S("Search text for action search"),
        url: S("URL for add or remove. Defaults to the current page."),
        title: S("Title for add"),
      },
      ["action"]
    ),
  },

  // ---- seeing ---------------------------------------------------------------
  {
    name: "get_page_snapshot",
    description:
      "Return the page URL, title, scroll position and a numbered list of interactive elements (links, buttons, inputs...). " +
      "Use the [ref] numbers with click, type_text, select_option, etc. Refs change on every snapshot, so re-snapshot after the page changes. " +
      "If the page has iframes, set includeFrames to see inside them.",
    parameters: obj({ maxElements: N("Max elements to return. Default 120."), includeFrames: B("Also snapshot iframes. Default false.") }),
  },
  {
    name: "list_frames",
    description: "List the frames (main page and iframes) in the current tab with their URLs.",
  },
  {
    name: "take_screenshot",
    description:
      "Capture the visible part of the current tab. The image is delivered to you as a video frame right after this call. " +
      "The result gives imageWidth and imageHeight; x/y coordinates for click_at and drag_and_drop are in the pixels of this image.",
  },
  {
    name: "full_page_screenshot",
    description: "Capture the whole page from top to bottom (not just the viewport) and send it to you as an image. Needs Trusted input.",
  },
  {
    name: "extract_text",
    description: "Read the visible text of the page, or of one element by ref. Use it to read articles, results, tables and confirmations.",
    parameters: obj({ ref: N("Optional element ref"), maxChars: N("Default 6000") }),
  },
  {
    name: "find_in_page",
    description:
      "Find text on the page without scrolling. Returns snippets, whether each is on screen, and the snapshot ref containing it when there is one. " +
      "Set scrollToIndex to scroll a match into view.",
    parameters: obj(
      { text: S("Text to find"), caseSensitive: B("Default false"), maxResults: N("Default 10"), scrollToIndex: N("Index of the match to scroll to") },
      ["text"]
    ),
  },
  {
    name: "wait_for",
    description:
      "Wait until text appears (or an element matching a CSS selector becomes visible), or with gone=true until it disappears. " +
      "Better than a fixed wait. Survives page navigations.",
    parameters: obj(
      { text: S("Text to wait for"), selector: S("CSS selector to wait for"), gone: B("Wait for it to disappear instead"), timeoutSeconds: N("1 to 30. Default 10.") }
    ),
  },
  {
    name: "wait",
    description: "Wait a fixed number of seconds. Prefer wait_for when you know what you are waiting for.",
    parameters: obj({ seconds: N("1 to 15") }, ["seconds"]),
  },
  {
    name: "get_console_logs",
    description:
      "Read the page's JavaScript console (errors, warnings, logs). Capture starts on the first call, so call it, reproduce the problem, then call it again. Needs Trusted input.",
    parameters: obj({
      action: S("read or clear", { enum: ["read", "clear"] }),
      level: S("Minimum level", { enum: ["log", "warning", "error"] }),
      max: N("Default 30"),
    }),
  },
  {
    name: "get_network_log",
    description:
      "Read network requests made by the page (URL, method, status, failures). Capture starts on the first call, so call it, reload or interact, then call it again. Needs Trusted input.",
    parameters: obj({
      action: S("read or clear", { enum: ["read", "clear"] }),
      filter: S("Only URLs containing this text"),
      onlyFailed: B("Only failed or 4xx/5xx requests"),
      types: { type: "ARRAY", items: { type: "STRING" }, description: "Resource types, e.g. XHR, Fetch, Document, Script, Image" },
      max: N("Default 30"),
    }),
  },

  // ---- acting ---------------------------------------------------------------
  {
    name: "click",
    description: "Click an element by ref from the latest snapshot. Reports navigation, newly opened tabs and open dialogs.",
    parameters: obj({ ref: N("Element ref"), double: B("Double click"), button: S("Mouse button", { enum: ["left", "right"] }) }, ["ref"]),
  },
  {
    name: "click_at",
    description:
      "Click at x/y pixel coordinates of the most recent screenshot. For canvases, maps and elements missing from the snapshot. Take a screenshot first. Needs Trusted input.",
    parameters: obj(
      { x: N("X in screenshot pixels"), y: N("Y in screenshot pixels"), double: B("Double click"), button: S("Mouse button", { enum: ["left", "right"] }) },
      ["x", "y"]
    ),
  },
  {
    name: "hover",
    description: "Move the mouse over an element (to open hover menus or tooltips).",
    parameters: obj({ ref: N("Element ref") }, ["ref"]),
  },
  {
    name: "drag_and_drop",
    description:
      "Drag from one point to another using refs or screenshot coordinates. Good for sliders, sortable lists, kanban cards, maps. " +
      "Uses mouse events, so native HTML5 drag-and-drop may not respond. Needs Trusted input.",
    parameters: obj({
      fromRef: N("Start element ref"),
      toRef: N("End element ref"),
      fromX: N("Start X in screenshot pixels"),
      fromY: N("Start Y in screenshot pixels"),
      toX: N("End X in screenshot pixels"),
      toY: N("End Y in screenshot pixels"),
    }),
  },
  {
    name: "type_text",
    description: "Type text into an input, textarea or contenteditable element by ref. Replaces existing content unless clear is false.",
    parameters: obj(
      { ref: N("Element ref"), text: S("Text to enter"), clear: B("Replace existing text. Default true."), submit: B("Press Enter afterwards. Default false.") },
      ["ref", "text"]
    ),
  },
  {
    name: "fill_form",
    description:
      "Fill several fields in one call. Each entry: ref and value. Works for text inputs, native selects (option text or value) and checkboxes/radios (value 'true' or 'false').",
    parameters: obj(
      {
        fields: {
          type: "ARRAY",
          description: "Fields to fill",
          items: obj({ ref: N("Element ref"), value: S("Value to set") }, ["ref", "value"]),
        },
      },
      ["fields"]
    ),
  },
  {
    name: "select_option",
    description: "Choose an option in a native <select> by option text or value.",
    parameters: obj({ ref: N("Element ref"), value: S("Option text or value") }, ["ref", "value"]),
  },
  {
    name: "press_key",
    description: "Press a keyboard key on the focused element, e.g. Enter, Tab, Escape, ArrowDown, PageDown, or a letter with modifiers.",
    parameters: obj({ key: S("Key name, e.g. Enter"), modifiers: { type: "ARRAY", items: S("ctrl, shift, alt or meta") } }, ["key"]),
  },
  {
    name: "scroll",
    description: "Scroll the page (or the element given by ref). Reports scroll position so you know when you hit the end.",
    parameters: obj(
      {
        direction: S("Direction", { enum: ["down", "up", "top", "bottom", "left", "right"] }),
        amount: N("Pixels. Default is about one viewport."),
        ref: N("Optional scrollable element ref"),
      },
      ["direction"]
    ),
  },
  {
    name: "handle_dialog",
    description:
      "Accept or dismiss a JavaScript alert, confirm or prompt dialog. While a dialog is open the page is frozen and other tools fail, so call this when told a dialog is open. Needs Trusted input.",
    parameters: obj(
      { action: S("What to do", { enum: ["accept", "dismiss", "status"] }), promptText: S("Text to enter for prompt() dialogs") }
    ),
  },
  {
    name: "upload_file",
    description:
      "Attach a local file to a file-upload field. Needs an absolute path on the user's computer that the user gave you. Always asks the user for approval. Needs Trusted input.",
    parameters: obj({ ref: N("Ref of the upload button or file input"), path: S("Absolute local file path") }, ["ref", "path"]),
  },

  // ---- output ---------------------------------------------------------------
  {
    name: "download_file",
    description: "Download a URL to the user's Downloads folder, list recent downloads, or cancel one.",
    parameters: obj(
      {
        action: S("What to do", { enum: ["download", "list", "cancel"] }),
        url: S("URL to download"),
        filename: S("Optional file name inside the Downloads folder"),
        id: N("Download id for cancel"),
      },
      ["action"]
    ),
  },
  {
    name: "save_pdf",
    description: "Save the current page as a PDF in Downloads/Gemini agent. Needs Trusted input.",
    parameters: obj({ landscape: B("Landscape orientation"), filename: S("File name without extension") }),
  },
  {
    name: "read_clipboard",
    description: "Read or set the system clipboard. Always asks the user for approval.",
    parameters: obj({ action: S("What to do", { enum: ["read", "write"] }), text: S("Text for write") }, ["action"]),
  },
  {
    name: "notify_user",
    description: "Show a desktop notification, for example when a long task finishes while the user is in another app.",
    parameters: obj({ title: S("Short title"), message: S("Message body") }, ["message"]),
  },

  // ---- power and system -----------------------------------------------------
  {
    name: "run_javascript",
    description:
      "LAST RESORT: run JavaScript in the current page and return the value of the last expression. Wrap in an async IIFE to use return. " +
      "Always asks the user for approval. Needs Trusted input.",
    parameters: obj({ code: S("JavaScript to run") }, ["code"]),
  },
  {
    name: "emulate_device",
    description:
      "Emulate a phone, tablet or desktop viewport, custom size, geolocation or dark/light mode on the current tab, or reset it. " +
      "Emulation ends when the debugger detaches (session end). Needs Trusted input.",
    parameters: obj({
      preset: S("Device preset", { enum: ["phone", "tablet", "desktop", "reset"] }),
      width: N("Custom viewport width"),
      height: N("Custom viewport height"),
      deviceScaleFactor: F("Pixel ratio, e.g. 2"),
      mobile: B("Mobile mode"),
      latitude: F("Geolocation latitude"),
      longitude: F("Geolocation longitude"),
      colorScheme: S("Preferred colour scheme", { enum: ["dark", "light", "none"] }),
      reload: B("Reload the page after applying. Default false."),
    }),
  },
  {
    name: "remember",
    description:
      "Save, recall, list or forget short notes that persist across sessions (user preferences, names, recurring tasks). Saving asks the user for approval. Do not store secrets.",
    parameters: obj(
      { action: S("What to do", { enum: ["save", "recall", "list", "forget"] }), key: S("Short name for the note"), value: S("Note text for save") },
      ["action"]
    ),
  },
  {
    name: "schedule_check",
    description:
      "Schedule a task to run later or repeatedly (e.g. 'check this price every hour'). When due, you receive the task as a message if a session is open. Creating asks the user for approval.",
    parameters: obj(
      {
        action: S("What to do", { enum: ["create", "list", "cancel"] }),
        name: S("Unique short name"),
        task: S("What to do when it fires, in plain language, including the URL if relevant"),
        everyMinutes: N("Interval in minutes, at least 1"),
        once: B("Run once after the delay instead of repeating"),
      },
      ["action"]
    ),
  },
];

// ---------------------------------------------------------------------------

const SENSITIVE_CLICK =
  /\b(buy|purchase|pay|place (your )?order|order now|checkout|check out|complete (order|purchase)|confirm (order|payment|purchase)|submit|send|post|publish|tweet|reply|delete|remove|unsubscribe|cancel (my )?(subscription|order|account)|close account|sign out|log ?out|transfer|withdraw|donate|subscribe|authorize|allow access|grant)\b/i;
const SENSITIVE_FIELD = /\b(password|passcode|otp|one[- ]time|card|cvv|cvc|ssn|social security|iban|routing|account number|pin)\b/i;
const TEXT_TYPES = new Set(["text", "search", "url", "tel", "email", "password", "textarea"]);

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const PRESETS = {
  phone: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, ua: ANDROID_UA },
  tablet: { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true, ua: ANDROID_UA },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safeName = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 80) || "page";

function normalizeUrl(u) {
  u = String(u || "").trim();
  if (!u) throw new Error("url is required");
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  return "https://" + u;
}

async function readClipboard() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    const ta = document.createElement("textarea");
    document.body.append(ta);
    ta.focus();
    const ok = document.execCommand("paste");
    const v = ta.value;
    ta.remove();
    if (!ok) throw new Error("Clipboard read failed. Click inside the side panel once, then try again.");
    return v;
  }
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/**
 * @param {object} ctx
 * @param {() => {trusted:boolean, approvals:boolean}} ctx.getSettings
 * @param {(summary:string) => Promise<boolean>} ctx.requestApproval
 * @param {(base64Jpeg:string) => void} ctx.sendImage       delivers a frame to the model
 * @param {(url:string) => void} [ctx.onScreenshot]         UI thumbnail
 */
export function createExecutor(ctx) {
  let targetTabId = null;
  const frameSlots = new Map(); // tabId -> Map(slot -> frameId); slot 0 is the main frame
  const lastShot = new Map(); // tabId -> { imgW, imgH, vw, vh }

  chrome.tabs.onActivated.addListener(({ tabId }) => (targetTabId = tabId));
  chrome.tabs.onRemoved.addListener((id) => {
    if (id === targetTabId) targetTabId = null;
    frameSlots.delete(id);
    lastShot.delete(id);
    cdp.detach(id);
  });

  async function getTab() {
    if (targetTabId != null) {
      try { return await chrome.tabs.get(targetTabId); } catch { targetTabId = null; }
    }
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!t) throw new Error("No active tab found.");
    targetTabId = t.id;
    return t;
  }

  const dialogError = (d) => new Error(`A ${d.type} dialog is open ("${String(d.message).slice(0, 120)}"). Call handle_dialog first.`);
  const HANG = "The page did not respond. A JavaScript dialog may be open: call handle_dialog, then retry.";

  /** Run a function in a tab (optionally a specific frame) with a hang guard. */
  async function run(tabId, func, args = [], frameId = 0, timeoutMs = 15000) {
    const d = cdp.pendingDialog(tabId);
    if (d) throw dialogError(d);
    const target = frameId ? { tabId, frameIds: [frameId] } : { tabId };
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(HANG)), timeoutMs); });
    try {
      const [res] = await Promise.race([chrome.scripting.executeScript({ target, func, args }), timeout]);
      return res?.result;
    } catch (e) {
      const m = String(e?.message || e);
      if (m === HANG) {
        const dd = cdp.pendingDialog(tabId);
        throw dd ? dialogError(dd) : e;
      }
      throw new Error(
        /cannot access|extensions gallery|chrome:\/\//i.test(m)
          ? "This page is restricted (browser-internal or store page); scripts can't run here. Navigate to a normal website."
          : m
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // Refs encode their frame: ref = slot * 1000 + localIndex. Slot 0 is the main frame.
  function splitRef(tabId, ref) {
    const slot = Math.floor(ref / 1000);
    const local = ref % 1000;
    if (slot === 0) return { frameId: 0, local, framed: false };
    const frameId = frameSlots.get(tabId)?.get(slot);
    if (frameId == null) throw new Error("Unknown or stale ref. Call get_page_snapshot again.");
    return { frameId, local, framed: true };
  }
  async function runRef(tabId, ref, func, args = []) {
    const { frameId, local } = splitRef(tabId, ref);
    return run(tabId, func, [local, ...args], frameId);
  }

  function waitComplete(tabId, ms = 15000) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve();
      };
      const listener = (id, info) => { if (id === tabId && info.status === "complete") finish(); };
      chrome.tabs.onUpdated.addListener(listener);
      const timer = setTimeout(finish, ms);
      chrome.tabs.get(tabId).then((t) => { if (t.status === "complete") finish(); }).catch(finish);
    });
  }

  async function settle(tabId, { navigated = false } = {}) {
    await sleep(navigated ? 350 : 250);
    await waitComplete(tabId, 12000);
    await sleep(navigated ? 500 : 150);
  }

  async function state(tabId) {
    try {
      const t = await chrome.tabs.get(tabId);
      return { url: t.url, title: t.title };
    } catch {
      return { url: null, title: null };
    }
  }

  const tabIds = async () => new Set((await chrome.tabs.query({})).map((t) => t.id));

  // ----- guards -------------------------------------------------------------
  /** `force` asks even when the user switched approvals off (for high-risk tools). */
  async function approve(summary, force = false) {
    if (!force && !ctx.getSettings().approvals) return true;
    return ctx.requestApproval(summary);
  }
  const DENIED = { error: "The user declined this action. Do not retry it; ask what they want instead." };

  function needCdp() {
    if (!ctx.getSettings().trusted) {
      throw new Error("This tool needs the Chrome debugger. Ask the user to turn on “Trusted input” in settings.");
    }
  }

  /** Convert screenshot pixels to CSS viewport pixels. */
  function toCss(tabId, x, y) {
    const s = lastShot.get(tabId);
    if (!s) throw new Error("Take a screenshot first; coordinates refer to the most recent screenshot image.");
    return { x: Math.round((x * s.vw) / s.imgW), y: Math.round((y * s.vh) / s.imgH) };
  }

  async function typeInto(tab, ref, text, { clear = true, submit = false } = {}) {
    const prep = await runRef(tab.id, ref, P.prepareType, [clear]);
    if (prep.error) return prep;
    const { trusted } = ctx.getSettings();
    let valueNow;
    if (trusted && (prep.kind === "contenteditable" || TEXT_TYPES.has(prep.type))) {
      await cdp.insertText(tab.id, text);
      valueNow = await runRef(tab.id, ref, P.readValue);
    } else {
      valueNow = (await runRef(tab.id, ref, P.setValue, [text, clear])).value;
    }
    if (submit) {
      if (trusted) await cdp.pressKey(tab.id, "Enter");
      else await run(tab.id, P.syntheticKey, ["Enter", []]);
      await settle(tab.id, { navigated: true });
    }
    return { typed: true, valueNow, submitted: !!submit };
  }

  /** Shared tail of click/click_at: settle, report navigation, new tabs and dialogs. */
  async function afterClick(tab, before, out) {
    await settle(tab.id);
    const after = await chrome.tabs.query({});
    const newTabs = after
      .filter((t) => !before.has(t.id))
      .map((t) => ({ tabId: t.id, url: t.url || t.pendingUrl, title: t.title }));
    Object.assign(out, await state(tab.id));
    if (newTabs.length) {
      out.newTabs = newTabs;
      out.hint = "A new tab opened. Use switch_tab to work in it.";
    }
    const d = cdp.pendingDialog(tab.id);
    if (d) {
      out.dialog = d;
      out.hint = "A JavaScript dialog is open. Call handle_dialog before anything else.";
    }
    return out;
  }

  // ----- the tools ----------------------------------------------------------
  const impl = {
    // ===== tabs and windows =====
    async list_tabs() {
      const cur = await getTab().catch(() => null);
      const tabs = await chrome.tabs.query({});
      return tabs.map((t) => ({
        tabId: t.id, title: t.title, url: t.url, active: t.active, workingTab: t.id === cur?.id,
        muted: t.mutedInfo?.muted || false, pinned: t.pinned, groupId: t.groupId,
      }));
    },

    async open_tab({ url, active = true }) {
      const tab = await chrome.tabs.create({ url: normalizeUrl(url), active });
      if (active) targetTabId = tab.id;
      await settle(tab.id, { navigated: true });
      return { tabId: tab.id, ...(await state(tab.id)) };
    },

    async close_tab({ tabId }) {
      const id = tabId ?? (await getTab()).id;
      await chrome.tabs.remove(id);
      if (id === targetTabId) targetTabId = null;
      return { closed: id };
    },

    async switch_tab({ tabId }) {
      const t = await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
      targetTabId = tabId;
      return { tabId, ...(await state(tabId)) };
    },

    async duplicate_tab({ tabId }) {
      const id = tabId ?? (await getTab()).id;
      const t = await chrome.tabs.duplicate(id);
      targetTabId = t.id;
      await settle(t.id, { navigated: true });
      return { tabId: t.id, ...(await state(t.id)) };
    },

    async reopen_closed_tab({ action = "restore", sessionId } = {}) {
      const recent = await chrome.sessions.getRecentlyClosed({ maxResults: 10 });
      if (action === "list") {
        return recent.map((s) =>
          s.tab
            ? { sessionId: s.tab.sessionId, type: "tab", title: s.tab.title, url: s.tab.url }
            : { sessionId: s.window.sessionId, type: "window", tabs: s.window.tabs?.length }
        );
      }
      const sid = sessionId || recent.find((s) => s.tab)?.tab.sessionId;
      if (!sid) return { error: "No recently closed tabs." };
      const restored = await chrome.sessions.restore(sid);
      if (restored.tab) {
        targetTabId = restored.tab.id;
        await settle(restored.tab.id, { navigated: true });
        return { restored: "tab", tabId: restored.tab.id, ...(await state(restored.tab.id)) };
      }
      return { restored: "window" };
    },

    async group_tabs({ action, tabIds, groupId, title, color, collapsed }) {
      if (action === "list") {
        const groups = await chrome.tabGroups.query({});
        const tabs = await chrome.tabs.query({});
        return groups.map((g) => ({
          groupId: g.id, title: g.title, color: g.color, collapsed: g.collapsed,
          tabs: tabs.filter((t) => t.groupId === g.id).map((t) => ({ tabId: t.id, title: t.title })),
        }));
      }
      const ids = tabIds?.length ? tabIds : [(await getTab()).id];
      if (action === "ungroup") {
        await chrome.tabs.ungroup(ids);
        return { ungrouped: ids };
      }
      let gid = groupId;
      if (action === "group") gid = await chrome.tabs.group(groupId != null ? { tabIds: ids, groupId } : { tabIds: ids });
      if (gid == null) throw new Error("groupId is required for update.");
      const props = {};
      if (title != null) props.title = title;
      if (color) props.color = color;
      if (collapsed != null) props.collapsed = collapsed;
      if (Object.keys(props).length) await chrome.tabGroups.update(gid, props);
      return { groupId: gid, tabIds: action === "group" ? ids : undefined, ...props };
    },

    async mute_tab({ action, tabId }) {
      const id = tabId ?? (await getTab()).id;
      const props = { mute: { muted: true }, unmute: { muted: false }, pin: { pinned: true }, unpin: { pinned: false } }[action];
      if (!props) throw new Error("Unknown action " + action);
      const t = await chrome.tabs.update(id, props);
      return { tabId: id, muted: t.mutedInfo?.muted || false, pinned: t.pinned, audible: !!t.audible };
    },

    async manage_window({ action, windowId, url, width, height, left, top }) {
      if (action === "list") {
        const wins = await chrome.windows.getAll({ populate: true });
        return wins.map((w) => ({ windowId: w.id, state: w.state, focused: w.focused, incognito: w.incognito, tabs: w.tabs?.length }));
      }
      if (action === "new" || action === "new_incognito") {
        const opts = { incognito: action === "new_incognito" };
        if (url) opts.url = normalizeUrl(url);
        if (width) opts.width = width;
        if (height) opts.height = height;
        let w;
        try {
          w = await chrome.windows.create(opts);
        } catch (e) {
          throw new Error(action === "new_incognito"
            ? "Could not open incognito. Enable “Allow in Incognito” for this extension in chrome://extensions."
            : String(e?.message || e));
        }
        const t = w.tabs?.[0];
        if (t) { targetTabId = t.id; await settle(t.id, { navigated: !!url }); }
        return { windowId: w.id, tabId: t?.id, incognito: w.incognito };
      }
      const id = windowId ?? (await getTab()).windowId;
      if (action === "close") {
        if (!(await approve("Close the whole browser window and all its tabs"))) return DENIED;
        await chrome.windows.remove(id);
        return { closed: id };
      }
      const props = {};
      if (action === "maximize") props.state = "maximized";
      else if (action === "minimize") props.state = "minimized";
      else if (action === "fullscreen") props.state = "fullscreen";
      else if (action === "restore") props.state = "normal";
      else if (action === "focus") props.focused = true;
      else if (action === "resize") {
        props.state = "normal";
        if (width) props.width = width;
        if (height) props.height = height;
        if (left != null) props.left = left;
        if (top != null) props.top = top;
      } else throw new Error("Unknown action " + action);
      const w = await chrome.windows.update(id, props);
      return { windowId: id, state: w.state, width: w.width, height: w.height };
    },

    async zoom_page({ action, factor }) {
      const tab = await getTab();
      const cur = await chrome.tabs.getZoom(tab.id);
      let z = cur;
      if (action === "in") z = Math.min(5, cur + 0.25);
      else if (action === "out") z = Math.max(0.25, cur - 0.25);
      else if (action === "set") z = Math.min(5, Math.max(0.25, Number(factor) || 1));
      else if (action === "reset") z = 0; // 0 = browser default
      await chrome.tabs.setZoom(tab.id, z);
      return { zoom: await chrome.tabs.getZoom(tab.id) };
    },

    // ===== navigation and browser data =====
    async navigate({ action, url }) {
      const tab = await getTab();
      if (action === "goto") await chrome.tabs.update(tab.id, { url: normalizeUrl(url) });
      else if (action === "back") await chrome.tabs.goBack(tab.id);
      else if (action === "forward") await chrome.tabs.goForward(tab.id);
      else if (action === "reload") await chrome.tabs.reload(tab.id);
      else throw new Error("Unknown action " + action);
      await settle(tab.id, { navigated: true });
      return { tabId: tab.id, ...(await state(tab.id)) };
    },

    async search({ query, newTab = false }) {
      const url = "https://www.google.com/search?q=" + encodeURIComponent(query);
      return newTab ? impl.open_tab({ url }) : impl.navigate({ action: "goto", url });
    },

    async get_history({ query = "", days = 7, maxResults = 10 } = {}) {
      const items = await chrome.history.search({
        text: query,
        maxResults: Math.min(50, Math.max(1, maxResults)),
        startTime: Date.now() - Math.max(1, days) * 86400000,
      });
      return items.map((i) => ({
        title: i.title, url: i.url, lastVisit: new Date(i.lastVisitTime).toISOString(), visits: i.visitCount,
      }));
    },

    async bookmark_page({ action = "add", query, url, title }) {
      const fmt = (b) => ({ id: b.id, title: b.title, url: b.url });
      if (action === "add") {
        const tab = await getTab();
        const b = await chrome.bookmarks.create({ title: title || tab.title, url: url || tab.url });
        return { added: fmt(b) };
      }
      if (action === "search") return (await chrome.bookmarks.search(query || "")).filter((b) => b.url).slice(0, 25).map(fmt);
      if (action === "list") return (await chrome.bookmarks.getRecent(15)).map(fmt);
      if (action === "remove") {
        const target = url || (await getTab()).url;
        const found = (await chrome.bookmarks.search({ url: target })).filter((b) => b.url);
        if (!found.length) return { error: "No bookmark with that URL." };
        if (!(await approve(`Remove bookmark: ${found[0].title || target}`))) return DENIED;
        for (const b of found) await chrome.bookmarks.remove(b.id);
        return { removed: found.length };
      }
      throw new Error("Unknown action " + action);
    },

    // ===== seeing =====
    async get_page_snapshot({ maxElements = 120, includeFrames = false } = {}) {
      const tab = await getTab();
      const cap = Math.min(300, Math.max(10, maxElements));
      const slots = new Map();
      frameSlots.set(tab.id, slots);
      const snap = await run(tab.id, P.snapshotPage, [cap, 0]);
      const out = { tabId: tab.id, ...snap };

      let frames = [];
      try {
        frames = ((await chrome.webNavigation.getAllFrames({ tabId: tab.id })) || []).filter(
          (f) => f.frameId !== 0 && /^(https?:|about:(blank|srcdoc))/.test(f.url)
        );
      } catch {}
      if (frames.length && !includeFrames) {
        out.iframes = frames.length;
        out.hint = "This page has iframes. Call get_page_snapshot with includeFrames true to see inside them.";
      } else if (frames.length) {
        out.frames = [];
        let slot = 1;
        for (const f of frames.slice(0, 8)) {
          try {
            const s = await run(tab.id, P.snapshotPage, [Math.min(cap, 80), slot * 1000], f.frameId, 8000);
            if (s && s.shown > 0) {
              slots.set(slot, f.frameId);
              out.frames.push({ frameUrl: f.url, elements: s.elements });
              slot++;
            }
          } catch {}
        }
      }
      return out;
    },

    async list_frames() {
      const tab = await getTab();
      const frames = (await chrome.webNavigation.getAllFrames({ tabId: tab.id })) || [];
      return frames.map((f) => ({ frameId: f.frameId, parentFrameId: f.parentFrameId, url: f.url }));
    },

    async take_screenshot() {
      const tab = await getTab();
      if (!tab.active) await chrome.tabs.update(tab.id, { active: true });
      let dataUrl;
      try {
        dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
      } catch (e) {
        throw new Error("Could not capture this tab: " + (e?.message || e));
      }
      const vp = await run(tab.id, P.viewportSize);
      const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const scale = Math.min(1, 1280 / bmp.width);
      const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
      canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      ctx.sendImage(bytesToBase64(bytes));
      ctx.onScreenshot?.(URL.createObjectURL(blob));
      lastShot.set(tab.id, { imgW: canvas.width, imgH: canvas.height, vw: vp.w, vh: vp.h });
      return {
        sent: true, imageWidth: canvas.width, imageHeight: canvas.height,
        note: "Screenshot delivered as an image frame. click_at and drag_and_drop coordinates use this image's pixels.",
      };
    },

    async full_page_screenshot() {
      needCdp();
      const tab = await getTab();
      const shot = await cdp.fullPageScreenshot(tab.id);
      ctx.sendImage(shot.data);
      ctx.onScreenshot?.(URL.createObjectURL(new Blob([base64ToBytes(shot.data)], { type: "image/jpeg" })));
      return {
        sent: true, imageWidth: shot.width, imageHeight: shot.height, truncated: shot.truncated,
        note: "Full-page image delivered. Do not use its coordinates with click_at; take a normal screenshot for that.",
      };
    },

    async extract_text({ ref, maxChars = 6000 } = {}) {
      const tab = await getTab();
      const max = Math.min(20000, maxChars);
      return ref != null ? runRef(tab.id, ref, P.extractText, [max]) : run(tab.id, P.extractText, [null, max]);
    },

    async find_in_page({ text, caseSensitive = false, maxResults = 10, scrollToIndex }) {
      const tab = await getTab();
      return run(tab.id, P.findInPage, [String(text), !!caseSensitive, Math.min(50, maxResults), scrollToIndex ?? null]);
    },

    async wait_for({ text, selector, gone = false, timeoutSeconds = 10 }) {
      if (!text && !selector) throw new Error("Give text or selector.");
      const tab = await getTab();
      const total = Math.min(30, Math.max(1, timeoutSeconds)) * 1000;
      const deadline = Date.now() + total;
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return { met: false, waitedSeconds: total / 1000 };
        try {
          return await run(tab.id, P.waitForCondition, [text || null, selector || null, !!gone, remaining], 0, remaining + 3000);
        } catch (e) {
          // The page navigated mid-wait (context destroyed): try again on the new page.
          if (/restricted|dialog/i.test(e.message)) throw e;
          await sleep(500);
        }
      }
    },

    async wait({ seconds }) {
      await sleep(Math.min(15, Math.max(0, Number(seconds) || 1)) * 1000);
      return { waited: seconds };
    },

    async get_console_logs({ action = "read", level, max = 30 } = {}) {
      needCdp();
      const tab = await getTab();
      if (action === "clear") { cdp.clearLogs(tab.id, "console"); return { cleared: true }; }
      const justStarted = await cdp.startConsole(tab.id);
      const entries = cdp.readConsole(tab.id, { level, max });
      return {
        capture: justStarted ? "Started just now. Reload or repeat the action, then call again." : "active",
        count: entries.length,
        entries: entries.map((e) => `[${e.level}] ${e.text}${e.source ? ` (${e.source})` : ""}`),
      };
    },

    async get_network_log({ action = "read", filter, onlyFailed = false, types, max = 30 } = {}) {
      needCdp();
      const tab = await getTab();
      if (action === "clear") { cdp.clearLogs(tab.id, "net"); return { cleared: true }; }
      const justStarted = await cdp.startNetwork(tab.id);
      const rows = cdp.readNetwork(tab.id, { filter, onlyFailed, types, max });
      return {
        capture: justStarted ? "Started just now. Reload or interact, then call again." : "active",
        count: rows.length,
        requests: rows.map(
          (r) => `${r.failed ? "FAILED" : r.status ?? "…"} ${r.method} ${r.url.slice(0, 140)} [${r.type}]${r.error ? " " + r.error : ""}`
        ),
      };
    },

    // ===== acting =====
    async click({ ref, double = false, button = "left" }) {
      const tab = await getTab();
      const { framed } = splitRef(tab.id, ref);
      const info = await runRef(tab.id, ref, P.inspectRef);
      if (info.error) return info;
      if (info.disabled) return { error: `"${info.label}" is disabled.` };

      if (SENSITIVE_CLICK.test(info.label) || info.isSubmit) {
        if (!(await approve(`Click “${info.label || info.tag}”`))) return DENIED;
      }

      const before = await tabIds();
      let via = "synthetic";
      let prep = null;
      if (!framed) {
        prep = await runRef(tab.id, ref, P.prepareClick);
        if (prep.error) return prep;
        if (ctx.getSettings().trusted && !prep.occluded) {
          try {
            await cdp.mouseClick(tab.id, prep.x, prep.y, { button, clickCount: double ? 2 : 1 });
            via = "trusted";
          } catch {
            via = "synthetic";
          }
        }
      }
      if (via === "synthetic") await runRef(tab.id, ref, P.syntheticClick, [double, button === "right"]);

      const out = { clicked: info.label || info.tag, via };
      if (prep?.occluded) out.warning = `Target was covered by "${prep.cover}"; used a DOM click instead.`;
      return afterClick(tab, before, out);
    },

    async click_at({ x, y, double = false, button = "left" }) {
      needCdp();
      const tab = await getTab();
      const pt = toCss(tab.id, x, y);
      const probe = await run(tab.id, P.probePoint, [pt.x, pt.y]);
      if (SENSITIVE_CLICK.test(probe.label) || probe.isSubmit) {
        if (!(await approve(`Click “${probe.label || probe.tag || "element"}” at the chosen point`))) return DENIED;
      }
      const before = await tabIds();
      await cdp.mouseClick(tab.id, pt.x, pt.y, { button, clickCount: double ? 2 : 1 });
      return afterClick(tab, before, { clickedAt: { x, y }, target: probe.label || probe.tag || null, via: "trusted" });
    },

    async hover({ ref }) {
      const tab = await getTab();
      const { framed } = splitRef(tab.id, ref);
      if (!framed && ctx.getSettings().trusted) {
        const prep = await runRef(tab.id, ref, P.prepareClick);
        if (prep.error) return prep;
        await cdp.mouseMove(tab.id, prep.x, prep.y);
      } else {
        const r = await runRef(tab.id, ref, P.syntheticHover);
        if (r.error) return r;
      }
      await sleep(300);
      return { hovered: true };
    },

    async drag_and_drop({ fromRef, toRef, fromX, fromY, toX, toY }) {
      needCdp();
      const tab = await getTab();
      const point = async (ref, x, y, which) => {
        if (ref != null) {
          if (splitRef(tab.id, ref).framed) throw new Error("Dragging inside iframes is not supported.");
          const p = await runRef(tab.id, ref, P.prepareClick);
          if (p.error) throw new Error(p.error);
          return { x: p.x, y: p.y };
        }
        if (x == null || y == null) throw new Error(`Give ${which}Ref or ${which}X and ${which}Y.`);
        return toCss(tab.id, x, y);
      };
      const to = await point(toRef, toX, toY, "to");
      const from = await point(fromRef, fromX, fromY, "from");
      await cdp.drag(tab.id, from, to);
      await settle(tab.id);
      const d = cdp.pendingDialog(tab.id);
      return { dragged: true, from, to, ...(d ? { dialog: d } : {}) };
    },

    async type_text({ ref, text, clear = true, submit = false }) {
      const tab = await getTab();
      const f = await runRef(tab.id, ref, P.describeField);
      if (f.error) return f;
      if (f.isPassword || SENSITIVE_FIELD.test(f.label)) {
        if (!(await approve(`Enter text into sensitive field “${f.label || f.type}”`))) return DENIED;
      }
      return typeInto(tab, ref, String(text), { clear, submit });
    },

    async fill_form({ fields }) {
      const tab = await getTab();
      const described = [];
      for (const f of fields) {
        const d = await runRef(tab.id, f.ref, P.describeField);
        if (d.error) return { error: `ref ${f.ref}: ${d.error}` };
        described.push(d);
      }
      const sensitive = described.filter((d) => d.isPassword || SENSITIVE_FIELD.test(d.label));
      if (sensitive.length) {
        const names = sensitive.map((d) => d.label || d.type).join(", ");
        if (!(await approve(`Fill sensitive fields: ${names}`))) return DENIED;
      }
      const results = [];
      for (let i = 0; i < fields.length; i++) {
        const { ref, value } = fields[i];
        const d = described[i];
        let r;
        if (d.tag === "select") r = await runRef(tab.id, ref, P.setSelect, [value]);
        else if (d.type === "checkbox" || d.type === "radio") r = await runRef(tab.id, ref, P.setChecked, [String(value).toLowerCase() !== "false"]);
        else r = await typeInto(tab, ref, String(value), { clear: true });
        results.push({ ref, label: d.label, ...r });
      }
      return { filled: results.length, results };
    },

    async select_option({ ref, value }) {
      const tab = await getTab();
      return runRef(tab.id, ref, P.setSelect, [value]);
    },

    async press_key({ key, modifiers = [] }) {
      const tab = await getTab();
      if (ctx.getSettings().trusted) await cdp.pressKey(tab.id, key, modifiers);
      else await run(tab.id, P.syntheticKey, [key, modifiers.map((m) => String(m).toLowerCase())]);
      await settle(tab.id);
      return { pressed: key, ...(await state(tab.id)) };
    },

    async scroll({ direction, amount, ref }) {
      const tab = await getTab();
      if (ref != null) {
        const { frameId, local } = splitRef(tab.id, ref);
        return run(tab.id, P.scrollPage, [direction, amount ?? null, local], frameId);
      }
      return run(tab.id, P.scrollPage, [direction, amount ?? null, null]);
    },

    async handle_dialog({ action = "accept", promptText } = {}) {
      needCdp();
      const tab = await getTab();
      await cdp.attach(tab.id);
      const d = cdp.pendingDialog(tab.id);
      if (action === "status") return d ? { open: true, ...d } : { open: false };
      try {
        await cdp.send(tab.id, "Page.handleJavaScriptDialog", { accept: action === "accept", promptText });
      } catch (e) {
        return { error: "No dialog is open, or it could not be handled: " + (e?.message || e) };
      }
      return { handled: true, action, dialog: d };
    },

    async upload_file({ ref, path }) {
      needCdp();
      const tab = await getTab();
      if (splitRef(tab.id, ref).framed) return { error: "Uploads inside iframes are not supported." };
      if (!(await approve(`Upload the local file ${path}`, true))) return DENIED;
      const token = "u" + Date.now();
      const m = await runRef(tab.id, ref, P.markFileInput, [token]);
      if (m.error) return m;
      try {
        const doc = await cdp.send(tab.id, "DOM.getDocument", { depth: 0 });
        const q = await cdp.send(tab.id, "DOM.querySelector", {
          nodeId: doc.root.nodeId,
          selector: `[data-agent-upload="${token}"]`,
        });
        if (!q.nodeId) return { error: "Could not locate the file input (it may be inside a shadow root)." };
        await cdp.send(tab.id, "DOM.setFileInputFiles", { files: [path], nodeId: q.nodeId });
      } finally {
        await run(tab.id, P.unmarkElement, [token]).catch(() => {});
      }
      return { uploaded: path };
    },

    // ===== output =====
    async download_file({ action = "download", url, filename, id }) {
      if (action === "list") {
        const items = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 10 });
        return items.map((d) => ({
          id: d.id, file: d.filename, url: d.url, state: d.state, bytes: d.totalBytes, received: d.bytesReceived,
        }));
      }
      if (action === "cancel") {
        await chrome.downloads.cancel(id);
        return { cancelled: id };
      }
      if (!url) throw new Error("url is required.");
      const target = normalizeUrl(url);
      if (!(await approve(`Download ${target}`))) return DENIED;
      const dlId = await chrome.downloads.download({ url: target, ...(filename ? { filename: safeName(filename) } : {}) });
      return { started: true, id: dlId };
    },

    async save_pdf({ landscape = false, filename } = {}) {
      needCdp();
      const tab = await getTab();
      const b64 = await cdp.printToPDF(tab.id, { landscape });
      const bytes = base64ToBytes(b64);
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const name = `Gemini agent/${safeName(filename || tab.title || "page")}.pdf`;
      const id = await chrome.downloads.download({ url: blobUrl, filename: name });
      setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
      return { saved: true, downloadId: id, file: name, kilobytes: Math.round(bytes.length / 1024) };
    },

    async read_clipboard({ action, text }) {
      if (action === "read") {
        if (!(await approve("Read your clipboard", true))) return DENIED;
        return { text: (await readClipboard()).slice(0, 6000) };
      }
      if (action === "write") {
        if (!(await approve(`Replace your clipboard with: ${String(text).slice(0, 80)}`, true))) return DENIED;
        await writeClipboard(String(text));
        return { written: true };
      }
      throw new Error("Unknown action " + action);
    },

    async notify_user({ title = "Gemini browser agent", message }) {
      await chrome.notifications.create("", {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: String(title).slice(0, 80),
        message: String(message).slice(0, 300),
      });
      return { notified: true };
    },

    // ===== power and system =====
    async run_javascript({ code }) {
      needCdp();
      const tab = await getTab();
      if (!(await approve(`Run JavaScript on this page:\n${String(code).slice(0, 300)}`, true))) return DENIED;
      const r = await cdp.evaluate(tab.id, String(code));
      if (r.exceptionDetails) {
        return { error: String(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "Script threw an error").slice(0, 600) };
      }
      const v = r.result;
      return { result: v?.value !== undefined ? v.value : v?.description ?? v?.type ?? null };
    },

    async emulate_device({ preset, width, height, deviceScaleFactor, mobile, latitude, longitude, colorScheme, reload = false } = {}) {
      needCdp();
      const tab = await getTab();
      const send = (m, p) => cdp.send(tab.id, m, p);
      if (preset === "reset") {
        await send("Emulation.clearDeviceMetricsOverride");
        await send("Emulation.setUserAgentOverride", { userAgent: "" });
        await send("Emulation.clearGeolocationOverride");
        await send("Emulation.setEmulatedMedia", { features: [] });
        await send("Emulation.setTouchEmulationEnabled", { enabled: false });
      } else {
        const base = { ...(PRESETS[preset] || {}) };
        const w = width ?? base.width;
        const h = height ?? base.height;
        const isMobile = mobile ?? base.mobile ?? false;
        if (w && h) {
          await send("Emulation.setDeviceMetricsOverride", {
            width: w, height: h, deviceScaleFactor: deviceScaleFactor ?? base.deviceScaleFactor ?? 1,
            mobile: isMobile, screenWidth: w, screenHeight: h,
          });
          await send("Emulation.setTouchEmulationEnabled", { enabled: isMobile });
        }
        if (base.ua) await send("Emulation.setUserAgentOverride", { userAgent: base.ua });
        else if (preset === "desktop") await send("Emulation.setUserAgentOverride", { userAgent: "" });
      }
      if (latitude != null && longitude != null) {
        await send("Emulation.setGeolocationOverride", { latitude, longitude, accuracy: 50 });
      }
      if (colorScheme) {
        await send("Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-color-scheme", value: colorScheme === "none" ? "" : colorScheme }],
        });
      }
      if (reload) {
        await chrome.tabs.reload(tab.id);
        await settle(tab.id, { navigated: true });
      }
      return { applied: true, preset: preset || "custom", note: "Emulation lasts until the session ends." };
    },

    async remember({ action, key, value }) {
      const { memory = {} } = await chrome.storage.local.get("memory");
      if (action === "list") return Object.entries(memory).map(([k, v]) => ({ key: k, value: v.value }));
      if (action === "recall") {
        if (!key) throw new Error("key is required.");
        if (memory[key]) return { key, value: memory[key].value };
        const hits = Object.entries(memory).filter(([k, v]) => k.includes(key) || v.value.includes(key));
        return hits.length ? hits.map(([k, v]) => ({ key: k, value: v.value })) : { error: "Nothing saved under that key." };
      }
      if (action === "forget") {
        if (!memory[key]) return { error: "Nothing saved under that key." };
        delete memory[key];
        await chrome.storage.local.set({ memory });
        return { forgotten: key };
      }
      if (action === "save") {
        if (!key || value == null) throw new Error("key and value are required.");
        const v = String(value).slice(0, 1500);
        // Saved notes are replayed into future system prompts, so a page must not be able to plant them silently.
        if (!(await approve(`Remember “${key}”: ${v.slice(0, 120)}`, true))) return DENIED;
        memory[String(key).slice(0, 60)] = { value: v, updated: Date.now() };
        await chrome.storage.local.set({ memory });
        return { saved: key };
      }
      throw new Error("Unknown action " + action);
    },

    async schedule_check({ action = "list", name, task, everyMinutes, once = false }) {
      const { schedules = {} } = await chrome.storage.local.get("schedules");
      if (action === "list") {
        const alarms = await chrome.alarms.getAll();
        return Object.entries(schedules).map(([n, s]) => ({
          name: n, task: s.task, everyMinutes: s.everyMinutes, once: !!s.once,
          nextRun: alarms.find((a) => a.name === "agent:" + n)?.scheduledTime
            ? new Date(alarms.find((a) => a.name === "agent:" + n).scheduledTime).toISOString() : null,
        }));
      }
      if (!name) throw new Error("name is required.");
      if (action === "cancel") {
        await chrome.alarms.clear("agent:" + name);
        delete schedules[name];
        await chrome.storage.local.set({ schedules });
        return { cancelled: name };
      }
      if (action === "create") {
        const n = Math.max(1, Math.round(Number(everyMinutes) || 0));
        if (!task || !everyMinutes) throw new Error("task and everyMinutes are required.");
        if (!(await approve(`Schedule “${name}” ${once ? "in" : "every"} ${n} min: ${String(task).slice(0, 120)}`))) return DENIED;
        await chrome.alarms.create("agent:" + name, { delayInMinutes: n, ...(once ? {} : { periodInMinutes: n }) });
        schedules[name] = { task: String(task).slice(0, 600), everyMinutes: n, once: !!once, created: Date.now() };
        await chrome.storage.local.set({ schedules });
        return { scheduled: name, everyMinutes: n, once: !!once, note: "Runs when the side panel session is open; otherwise you get a notification." };
      }
      throw new Error("Unknown action " + action);
    },
  };

  async function execute(name, args = {}) {
    const fn = impl[name];
    if (!fn) return { error: `Unknown tool: ${name}` };
    try {
      const out = await fn(args);
      return out ?? { ok: true };
    } catch (e) {
      return { error: String(e?.message || e) };
    }
  }

  async function getMemoryDigest() {
    const { memory = {} } = await chrome.storage.local.get("memory");
    return Object.entries(memory).map(([k, v]) => `- ${k}: ${v.value}`).join("\n").slice(0, 3000);
  }

  return { execute, getTab, getMemoryDigest, cleanup: () => cdp.detachAll() };
}
