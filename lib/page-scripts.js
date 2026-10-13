// Functions in this file are serialized and injected into the page with
// chrome.scripting.executeScript({ func, args }). Each one MUST be fully
// self-contained: no references to anything outside its own body, except
// `window.__agent`, which snapshotPage() creates in the extension's isolated
// world and which persists between calls on the same page.

/**
 * Build a numbered list of interactive elements. Refs are valid until the next snapshot.
 * refBase offsets the printed numbers so refs from iframes never collide with the main frame
 * (the executor maps ref -> frame; inside the page the index is always local).
 */
export function snapshotPage(maxElements, refBase = 0) {
  const SEL = [
    "a[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary",
    "[role=button]", "[role=link]", "[role=checkbox]", "[role=radio]", "[role=switch]",
    "[role=tab]", "[role=menuitem]", "[role=option]", "[role=combobox]", "[role=textbox]",
    "[role=searchbox]", "[role=slider]", "[onclick]", "[contenteditable='']",
    "[contenteditable=true]", "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  const found = [];
  const seen = new Set();
  (function walk(root) {
    root.querySelectorAll(SEL).forEach((el) => {
      if (!seen.has(el)) { seen.add(el); found.push(el); }
    });
    root.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot); });
  })(document);

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  const label = (el) => {
    let t = el.getAttribute("aria-label");
    if (!t && el.getAttribute("aria-labelledby")) {
      t = el.getAttribute("aria-labelledby").split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText || "").join(" ");
    }
    if (!t && el.labels && el.labels.length) t = [...el.labels].map((l) => l.innerText).join(" ");
    if (!t && el.tagName === "INPUT" && ["button", "submit", "reset"].includes(el.type)) t = el.value;
    if (!t) t = el.innerText;
    if (!t) t = el.querySelector?.("img[alt]")?.alt;
    if (!t) t = el.placeholder || el.title || el.alt || el.getAttribute("name") || "";
    return clean(t).slice(0, 80);
  };

  const vw = window.innerWidth, vh = window.innerHeight;
  const entries = [];
  found.forEach((el, idx) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) return;
    const inView = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    entries.push({ el, idx, inView });
  });

  const inView = entries.filter((e) => e.inView);
  const off = entries.filter((e) => !e.inView);
  const picked = inView.slice(0, maxElements)
    .concat(off.slice(0, Math.max(0, maxElements - inView.length)))
    .sort((a, b) => a.idx - b.idx);

  window.__agent = { refs: picked.map((p) => p.el), label };

  const lines = picked.map((p, i) => {
    const el = p.el;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    const bits = [`[${refBase + i}] ${role || tag}`];
    const l = label(el);
    if (l) bits.push(JSON.stringify(l));
    const attrs = [];
    if (tag === "input" || tag === "textarea") {
      if (el.type && el.type !== "text") attrs.push(`type=${el.type}`);
      if (el.type === "checkbox" || el.type === "radio") attrs.push(el.checked ? "checked" : "unchecked");
      else if (el.value) attrs.push(`value=${JSON.stringify(el.type === "password" ? "••••" : el.value.slice(0, 60))}`);
    }
    if (tag === "select") {
      const o = el.selectedOptions?.[0];
      if (o) attrs.push(`selected=${JSON.stringify(clean(o.text).slice(0, 40))}`);
    }
    if (el.getAttribute("aria-checked")) attrs.push(`aria-checked=${el.getAttribute("aria-checked")}`);
    if (el.getAttribute("aria-expanded")) attrs.push(`expanded=${el.getAttribute("aria-expanded")}`);
    if (el.disabled || el.getAttribute("aria-disabled") === "true") attrs.push("disabled");
    if (tag === "a" && el.href) {
      try {
        const u = new URL(el.href);
        attrs.push(`href=${u.origin === location.origin ? u.pathname + u.search : u.href}`.slice(0, 90));
      } catch {}
    }
    if (!p.inView) attrs.push("offscreen");
    return attrs.length ? `${bits.join(" ")} {${attrs.join(", ")}}` : bits.join(" ");
  });

  const root = document.scrollingElement || document.documentElement;
  return {
    url: location.href,
    title: document.title,
    viewport: { width: vw, height: vh },
    scrollY: Math.round(root.scrollTop),
    scrollMax: Math.max(0, Math.round(root.scrollHeight - vh)),
    totalInteractive: entries.length,
    shown: lines.length,
    elements: lines,
  };
}

/** Basic info about a ref, used for approval gating before acting. */
export function inspectRef(ref) {
  const el = window.__agent?.refs?.[ref];
  if (!el || !el.isConnected) return { error: "Unknown or stale ref. Call get_page_snapshot again." };
  return {
    label: window.__agent.label(el),
    tag: el.tagName.toLowerCase(),
    type: el.type || null,
    role: el.getAttribute("role"),
    isPassword: el.type === "password",
    isSubmit: el.type === "submit" || (el.tagName === "BUTTON" && (!el.type || el.type === "submit") && !!el.form),
    disabled: !!el.disabled,
  };
}

/** Scroll element to centre and report where to click. */
export function prepareClick(ref) {
  const el = window.__agent?.refs?.[ref];
  if (!el || !el.isConnected) return { error: "Unknown or stale ref. Call get_page_snapshot again." };
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2);
  const y = Math.round(r.top + r.height / 2);
  const root = el.getRootNode();
  const top = (root.elementFromPoint ? root : document).elementFromPoint(x, y);
  const occluded = !!top && top !== el && !el.contains(top) && !top.contains(el);
  return {
    x, y, occluded,
    cover: occluded ? window.__agent.label(top) || top.tagName.toLowerCase() : null,
    disabled: !!el.disabled,
  };
}

/** Fallback click using DOM events (used when trusted input is off or the target is occluded). */
export function syntheticClick(ref, double, right) {
  const el = window.__agent?.refs?.[ref];
  if (!el || !el.isConnected) return { error: "Unknown or stale ref. Call get_page_snapshot again." };
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  const o = {
    bubbles: true, cancelable: true, composed: true, view: window,
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: right ? 2 : 0,
  };
  el.focus?.();
  el.dispatchEvent(new PointerEvent("pointerdown", o));
  el.dispatchEvent(new MouseEvent("mousedown", o));
  el.dispatchEvent(new PointerEvent("pointerup", o));
  el.dispatchEvent(new MouseEvent("mouseup", o));
  if (right) el.dispatchEvent(new MouseEvent("contextmenu", o));
  else {
    el.click();
    if (double) { el.click(); el.dispatchEvent(new MouseEvent("dblclick", o)); }
  }
  return { clicked: true };
}

export function syntheticHover(ref) {
  const el = window.__agent?.refs?.[ref];
  if (!el || !el.isConnected) return { error: "Unknown or stale ref. Call get_page_snapshot again." };
  el.scrollIntoView({ block: "center", behavior: "instant" });
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]
    .forEach((t) => el.dispatchEvent(new MouseEvent(t, o)));
  return { hovered: true };
}

/** Focus a field and select its contents so the next insert replaces them. */
export function prepareType(ref, clear) {
  const el = window.__agent?.refs?.[ref];
  if (!el || !el.isConnected) return { error: "Unknown or stale ref. Call get_page_snapshot again." };
  el.scrollIntoView({ block: "center", behavior: "instant" });
  el.focus();
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") {
    if (el.disabled || el.readOnly) return { error: "Field is disabled or read-only." };
    try {
      if (clear) el.select();
      else el.setSelectionRange(el.value.length, el.value.length);
    } catch {}
    return { kind: "input", type: tag === "TEXTAREA" ? "textarea" : el.type || "text" };
  }
  if (el.isContentEditable) {
    const sel = getSelection();
    const rng = document.createRange();
    rng.selectNodeContents(el);
    if (!clear) rng.collapse(false);
    sel.removeAllRanges();
    sel.addRange(rng);
    return { kind: "contenteditable" };
  }
  return { error: "Element is not a text field. Click it first, or choose another ref." };
}

/** Set a value the way frameworks (React/Vue) expect, with input+change events. */
export function setValue(ref, text, clear) {
  const el = window.__agent?.refs?.[ref];
  if (!el || !el.isConnected) return { error: "Unknown or stale ref. Call get_page_snapshot again." };
  if (el.isContentEditable && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") {
    el.focus();
    document.execCommand("insertText", false, text);
    return { value: (el.innerText || "").slice(0, 100) };
  }
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, clear ? text : el.value + text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { value: el.type === "password" ? "••••" : String(el.value).slice(0, 100) };
}

export function readValue(ref) {
  const el = window.__agent?.refs?.[ref];
  if (!el) return null;
  if (el.type === "password") return "••••";
  return String(el.value ?? el.innerText ?? "").slice(0, 100);
}

export function describeField(ref) {
  const el = window.__agent?.refs?.[ref];
  if (!el || !el.isConnected) return { error: "Unknown or stale ref. Call get_page_snapshot again." };
  return {
    tag: el.tagName.toLowerCase(),
    type: el.type || null,
    isPassword: el.type === "password",
    label: window.__agent.label(el),
  };
}

export function setSelect(ref, value) {
  const el = window.__agent?.refs?.[ref];
  if (!el || !el.isConnected) return { error: "Unknown or stale ref. Call get_page_snapshot again." };
  if (el.tagName !== "SELECT") return { error: "Not a native <select>. Click it and click an option instead." };
  const v = String(value).toLowerCase().trim();
  const opts = [...el.options];
  const o =
    opts.find((x) => x.value.toLowerCase() === v) ||
    opts.find((x) => x.text.trim().toLowerCase() === v) ||
    opts.find((x) => x.text.toLowerCase().includes(v));
  if (!o) return { error: "No matching option.", options: opts.slice(0, 40).map((x) => x.text.trim()) };
  el.value = o.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { selected: o.text.trim() };
}

export function setChecked(ref, checked) {
  const el = window.__agent?.refs?.[ref];
  if (!el || !el.isConnected) return { error: "Unknown or stale ref. Call get_page_snapshot again." };
  if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
    if (el.checked !== checked) el.click();
    return { checked: el.checked };
  }
  const ac = el.getAttribute("aria-checked");
  if (ac != null) {
    if ((ac === "true") !== checked) el.click();
    return { checked: el.getAttribute("aria-checked") === "true" };
  }
  return { error: "Not a checkbox/radio." };
}

/** Scroll the page (or a ref'd container). Falls back to the largest scrollable area. */
export function scrollPage(direction, amount, ref) {
  const root = document.scrollingElement || document.documentElement;
  const el = ref != null ? window.__agent?.refs?.[ref] : null;
  const step = amount || Math.round(window.innerHeight * 0.85);
  const apply = (t) => {
    const isWin = t === window;
    const by = (dx, dy) => (isWin ? window.scrollBy(dx, dy) : t.scrollBy(dx, dy));
    const to = (x, y) => (isWin ? window.scrollTo(x, y) : t.scrollTo(x, y));
    if (direction === "down") by(0, step);
    else if (direction === "up") by(0, -step);
    else if (direction === "left") by(-step, 0);
    else if (direction === "right") by(step, 0);
    else if (direction === "top") to(0, 0);
    else if (direction === "bottom") to(0, 1e9);
  };
  const pos = (t) => (t === window ? root.scrollTop : t.scrollTop);

  const target = el || window;
  const before = pos(target);
  apply(target);

  if (!el && pos(window) === before) {
    // Many web apps scroll an inner container instead of the window.
    let best = null, bestArea = 0;
    document.querySelectorAll("*").forEach((n) => {
      if (n.scrollHeight <= n.clientHeight + 40) return;
      const oy = getComputedStyle(n).overflowY;
      if (oy !== "auto" && oy !== "scroll") return;
      const r = n.getBoundingClientRect();
      const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) *
                   Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      if (area > bestArea) { best = n; bestArea = area; }
    });
    if (best) {
      const b = best.scrollTop;
      apply(best);
      return { scrolled: best.scrollTop !== b, container: "inner", scrollTop: Math.round(best.scrollTop),
               scrollMax: Math.round(best.scrollHeight - best.clientHeight) };
    }
  }
  const t = el || root;
  return {
    scrolled: pos(target) !== before,
    scrollY: Math.round(el ? el.scrollTop : root.scrollTop),
    scrollMax: Math.round(el ? el.scrollHeight - el.clientHeight : root.scrollHeight - innerHeight),
  };
}

export function extractText(ref, max) {
  const el = ref != null ? window.__agent?.refs?.[ref] : document.body;
  if (!el) return { error: "Unknown or stale ref. Call get_page_snapshot again." };
  const text = (el.innerText || el.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  return { text: text.slice(0, max), truncated: text.length > max, totalChars: text.length };
}

/** Fallback key press using DOM events. */
export function syntheticKey(key, mods) {
  const el = document.activeElement || document.body;
  const o = {
    key, bubbles: true, cancelable: true, composed: true,
    ctrlKey: mods.includes("ctrl"), shiftKey: mods.includes("shift"),
    altKey: mods.includes("alt"), metaKey: mods.includes("meta"),
  };
  el.dispatchEvent(new KeyboardEvent("keydown", o));
  el.dispatchEvent(new KeyboardEvent("keypress", o));
  el.dispatchEvent(new KeyboardEvent("keyup", o));
  if (key === "Enter" && el.form && el.tagName !== "TEXTAREA") {
    try { el.form.requestSubmit(); } catch { el.form.submit(); }
  }
  return { pressed: key };
}

// ---------------------------------------------------------------------------
// Added in v1.1
// ---------------------------------------------------------------------------

export function viewportSize() {
  return { w: window.innerWidth, h: window.innerHeight };
}

/** What would a click at (x, y) hit? Used so coordinate clicks still go through approvals. */
export function probePoint(x, y) {
  let el = document.elementFromPoint(x, y);
  while (el && el.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  if (!el) return { tag: null, label: "", isSubmit: false };
  const t = el.closest("a,button,input,select,textarea,summary,[role=button],[role=link],[onclick]") || el;
  const raw = t.getAttribute("aria-label") || t.innerText || t.value || t.title || t.alt || "";
  return {
    tag: t.tagName.toLowerCase(),
    label: String(raw).replace(/\s+/g, " ").trim().slice(0, 80),
    isSubmit: t.type === "submit" || (t.tagName === "BUTTON" && !!t.form && (!t.type || t.type === "submit")),
  };
}

/** Find visible text on the page. Returns snippets and, when possible, the snapshot ref that contains each hit. */
export function findInPage(text, caseSensitive, maxResults, scrollToIndex) {
  const q = caseSensitive ? text : text.toLowerCase();
  const matches = [];
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode()) && matches.length < 500) {
    const s = node.nodeValue;
    if (!s || s.length < q.length) continue;
    const hay = caseSensitive ? s : s.toLowerCase();
    const i = hay.indexOf(q);
    if (i < 0) continue;
    const p = node.parentElement;
    if (!p) continue;
    const tag = p.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEXTAREA") continue;
    if (p.checkVisibility && !p.checkVisibility({ checkVisibilityCSS: true })) continue;
    const r = p.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    matches.push({ el: p, snippet: s.slice(Math.max(0, i - 40), i + q.length + 40).replace(/\s+/g, " ").trim() });
  }
  if (scrollToIndex != null && matches[scrollToIndex]) {
    matches[scrollToIndex].el.scrollIntoView({ block: "center", behavior: "instant" });
  }
  const refs = (window.__agent && window.__agent.refs) || [];
  const vh = window.innerHeight;
  const shown = matches.slice(0, maxResults).map((m, index) => {
    let ref = null;
    for (let k = 0; k < refs.length; k++) if (refs[k].isConnected && refs[k].contains(m.el)) ref = k;
    const r = m.el.getBoundingClientRect();
    return { index, snippet: m.snippet, ref, inViewport: r.bottom > 0 && r.top < vh };
  });
  return { query: text, total: matches.length, shown: shown.length, matches: shown, scrolledTo: scrollToIndex ?? null };
}

/** Resolves when ALL given conditions hold (or, with gone=true, when they no longer hold). */
export function waitForCondition(text, selector, gone, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const lower = text ? text.toLowerCase() : null;
    const check = () => {
      let found = true;
      if (lower) found = ((document.body && document.body.innerText) || "").toLowerCase().includes(lower);
      if (found && selector) {
        const el = document.querySelector(selector);
        found = !!el && (!el.checkVisibility || el.checkVisibility({ checkVisibilityCSS: true }));
      }
      return gone ? !found : found;
    };
    const tick = () => {
      if (check()) return resolve({ met: true, waitedMs: Date.now() - start });
      if (Date.now() - start >= timeoutMs) return resolve({ met: false, waitedMs: Date.now() - start });
      setTimeout(tick, 250);
    };
    tick();
  });
}

/** Tag the file input behind a ref (the input itself, its label's control, or one inside it) so CDP can find it. */
export function markFileInput(ref, token) {
  const el = window.__agent?.refs?.[ref];
  if (!el || !el.isConnected) return { error: "Unknown or stale ref. Call get_page_snapshot again." };
  let input = null;
  if (el.tagName === "INPUT" && el.type === "file") input = el;
  else if (el.control && el.control.type === "file") input = el.control;
  else input = el.querySelector?.("input[type=file]") || el.closest?.("label")?.control || null;
  if (!input || input.type !== "file") return { error: "That element is not a file input. Pick the upload button or the file input's ref." };
  input.setAttribute("data-agent-upload", token);
  return { ok: true };
}

export function unmarkElement(token) {
  document.querySelectorAll(`[data-agent-upload="${token}"]`).forEach((n) => n.removeAttribute("data-agent-upload"));
  return true;
}
