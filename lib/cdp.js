// Wrapper over chrome.debugger (Chrome DevTools Protocol).
// Gives us trusted input plus everything DevTools can do: dialogs, console and
// network capture, full-page screenshots, PDF, emulation, JS evaluation.
// Attaching shows Chrome's "...started debugging this browser" banner.

const attached = new Set();

// Per-tab capture buffers, filled by CDP events once a feature is switched on.
const buffers = new Map(); // tabId -> { console: [], net: Map, dialog: null, on: Set }
const buf = (tabId) => {
  let b = buffers.get(tabId);
  if (!b) buffers.set(tabId, (b = { console: [], net: new Map(), dialog: null, on: new Set() }));
  return b;
};

export async function attach(tabId) {
  if (attached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (e) {
    if (!/already attached/i.test(String(e?.message || e))) throw e;
  }
  attached.add(tabId);
  // Needed so we hear about alert/confirm/prompt dialogs.
  chrome.debugger.sendCommand({ tabId }, "Page.enable").catch(() => {});
}

export async function detach(tabId) {
  buffers.delete(tabId);
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try { await chrome.debugger.detach({ tabId }); } catch {}
}

export async function detachAll() {
  await Promise.all([...attached].map(detach));
}

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) {
    attached.delete(source.tabId);
    buffers.delete(source.tabId);
  }
});

const cap = (arr, n) => { while (arr.length > n) arr.shift(); };
const argText = (a) =>
  a.value !== undefined ? (typeof a.value === "string" ? a.value : JSON.stringify(a.value)) : a.description || a.type;

chrome.debugger.onEvent.addListener((source, method, p) => {
  const tabId = source.tabId;
  if (tabId == null) return;
  const b = buf(tabId);
  switch (method) {
    case "Page.javascriptDialogOpening":
      b.dialog = { type: p.type, message: p.message, url: p.url, defaultPrompt: p.defaultPrompt };
      break;
    case "Page.javascriptDialogClosed":
      b.dialog = null;
      break;
    case "Runtime.consoleAPICalled":
      b.console.push({ level: p.type === "warn" ? "warning" : p.type, text: (p.args || []).map(argText).join(" ").slice(0, 500) });
      cap(b.console, 300);
      break;
    case "Runtime.exceptionThrown": {
      const d = p.exceptionDetails || {};
      b.console.push({
        level: "error",
        text: String(d.exception?.description || d.text || "Uncaught exception").slice(0, 500),
        source: d.url ? `${d.url}:${d.lineNumber}` : "",
      });
      cap(b.console, 300);
      break;
    }
    case "Log.entryAdded":
      b.console.push({ level: p.entry.level, text: String(p.entry.text).slice(0, 500), source: p.entry.url || "" });
      cap(b.console, 300);
      break;
    case "Network.requestWillBeSent":
      b.net.set(p.requestId, { method: p.request.method, url: p.request.url, type: p.type });
      if (b.net.size > 400) b.net.delete(b.net.keys().next().value);
      break;
    case "Network.responseReceived": {
      const e = b.net.get(p.requestId);
      if (e) { e.status = p.response.status; e.mime = p.response.mimeType; }
      break;
    }
    case "Network.loadingFailed": {
      const e = b.net.get(p.requestId);
      if (e) { e.failed = true; e.error = p.errorText; }
      break;
    }
  }
});

/**
 * Send a CDP command. Input.* commands can hang while an alert() is open, so
 * they resolve with {timedOut:true} instead of rejecting (callers must not
 * retry them, which could double-click). Everything else rejects on timeout.
 */
export async function send(tabId, method, params = {}, timeoutMs) {
  await attach(tabId);
  const isInput = method.startsWith("Input.");
  const limit = timeoutMs ?? (isInput ? 3000 : 20000);
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => (isInput ? resolve({ timedOut: true }) : reject(new Error(`${method} timed out`))), limit);
  });
  try {
    return await Promise.race([chrome.debugger.sendCommand({ tabId }, method, params), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ----- input ---------------------------------------------------------------
export async function mouseClick(tabId, x, y, { button = "left", clickCount = 1 } = {}) {
  await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  for (let i = 1; i <= clickCount; i++) {
    await send(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: i });
    await send(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: i });
  }
}

export async function mouseMove(tabId, x, y) {
  await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

/** Press at `from`, move in small steps, release at `to`. Works for sliders, sortable lists, maps. */
export async function drag(tabId, from, to, steps = 14) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
  await send(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await send(tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Math.round(from.x + (to.x - from.x) * t),
      y: Math.round(from.y + (to.y - from.y) * t),
      button: "left",
      buttons: 1,
    });
    await sleep(16);
  }
  await send(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1 });
}

export async function insertText(tabId, text) {
  await send(tabId, "Input.insertText", { text });
}

const KEYS = {
  Enter: { code: "Enter", vk: 13, text: "\r" },
  Tab: { code: "Tab", vk: 9 },
  Escape: { code: "Escape", vk: 27 },
  Backspace: { code: "Backspace", vk: 8 },
  Delete: { code: "Delete", vk: 46 },
  Space: { key: " ", code: "Space", vk: 32, text: " " },
  ArrowUp: { code: "ArrowUp", vk: 38 },
  ArrowDown: { code: "ArrowDown", vk: 40 },
  ArrowLeft: { code: "ArrowLeft", vk: 37 },
  ArrowRight: { code: "ArrowRight", vk: 39 },
  Home: { code: "Home", vk: 36 },
  End: { code: "End", vk: 35 },
  PageUp: { code: "PageUp", vk: 33 },
  PageDown: { code: "PageDown", vk: 34 },
};

const MOD = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, shift: 8 };

export async function pressKey(tabId, keyName, modifiers = []) {
  const mods = modifiers.reduce((m, k) => m | (MOD[String(k).toLowerCase()] || 0), 0);
  let def = KEYS[keyName] || KEYS[keyName[0]?.toUpperCase() + keyName.slice(1)];
  let key = keyName;
  if (!def) {
    if (keyName.length !== 1) throw new Error(`Unsupported key: ${keyName}`);
    const upper = keyName.toUpperCase();
    def = {
      code: /[a-z]/i.test(keyName) ? `Key${upper}` : /\d/.test(keyName) ? `Digit${keyName}` : "",
      vk: upper.charCodeAt(0),
      text: keyName,
    };
  } else if (def.key) {
    key = def.key;
  } else {
    key = def.code;
  }
  const text = mods & (1 | 2 | 4) ? undefined : def.text;
  const base = { key, code: def.code, windowsVirtualKeyCode: def.vk, nativeVirtualKeyCode: def.vk, modifiers: mods };
  await send(tabId, "Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, text });
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

// ----- dialogs -------------------------------------------------------------
export const pendingDialog = (tabId) => buffers.get(tabId)?.dialog || null;

// ----- console / network capture ------------------------------------------
/** Returns true if capture was started just now (so earlier messages were not recorded). */
export async function startConsole(tabId) {
  const b = buf(tabId);
  if (b.on.has("console")) return false;
  await send(tabId, "Runtime.enable");
  await send(tabId, "Log.enable");
  b.on.add("console");
  return true;
}

export async function startNetwork(tabId) {
  const b = buf(tabId);
  if (b.on.has("net")) return false;
  await send(tabId, "Network.enable");
  b.on.add("net");
  return true;
}

const LEVEL_RANK = { debug: 0, verbose: 0, log: 1, info: 1, warning: 2, error: 3, assert: 3 };

export function readConsole(tabId, { level, max = 30 } = {}) {
  const min = level ? LEVEL_RANK[level] ?? 0 : 0;
  return buf(tabId).console.filter((e) => (LEVEL_RANK[e.level] ?? 1) >= min).slice(-max);
}

export function readNetwork(tabId, { filter, onlyFailed, types, max = 30 } = {}) {
  let rows = [...buf(tabId).net.values()];
  if (filter) rows = rows.filter((r) => r.url.toLowerCase().includes(filter.toLowerCase()));
  if (types?.length) rows = rows.filter((r) => types.map((t) => t.toLowerCase()).includes(String(r.type).toLowerCase()));
  if (onlyFailed) rows = rows.filter((r) => r.failed || r.status >= 400);
  return rows.slice(-max);
}

export function clearLogs(tabId, which) {
  const b = buf(tabId);
  if (which === "console") b.console.length = 0;
  else b.net.clear();
}

// ----- capture / render ----------------------------------------------------
/** Whole-page JPEG, scaled to maxWidth and capped in height. */
export async function fullPageScreenshot(tabId, { maxWidth = 1280, maxHeight = 7000 } = {}) {
  const m = await send(tabId, "Page.getLayoutMetrics");
  const size = m.cssContentSize || m.contentSize;
  const scale = Math.min(1, maxWidth / size.width);
  const clipHeight = Math.min(size.height, maxHeight / scale);
  const r = await send(
    tabId,
    "Page.captureScreenshot",
    { format: "jpeg", quality: 60, captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height: clipHeight, scale } },
    30000
  );
  return {
    data: r.data,
    width: Math.round(size.width * scale),
    height: Math.round(clipHeight * scale),
    truncated: clipHeight < size.height,
  };
}

export async function printToPDF(tabId, { landscape = false } = {}) {
  const r = await send(tabId, "Page.printToPDF", { printBackground: true, landscape }, 30000);
  return r.data; // base64
}

export async function evaluate(tabId, expression) {
  return send(
    tabId,
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true, timeout: 10000 },
    20000
  );
}
