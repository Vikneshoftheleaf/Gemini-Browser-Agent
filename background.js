// Opens the side panel when the toolbar icon is clicked, and fires scheduled checks.
// Agent logic lives in the side panel page, which stays alive while it is open
// (a service worker would be killed after ~30s of idleness and drop the WebSocket).
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.error(e));
});

// schedule_check creates alarms named "agent:<name>" and stores the task in
// chrome.storage.local.schedules. When one fires, hand it to the side panel if a
// session is open and idle; otherwise show a notification so nothing is lost.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith("agent:")) return;
  const name = alarm.name.slice("agent:".length);
  const { schedules = {} } = await chrome.storage.local.get("schedules");
  const s = schedules[name];
  if (!s) {
    chrome.alarms.clear(alarm.name);
    return;
  }

  let handled = false;
  try {
    const reply = await chrome.runtime.sendMessage({ type: "scheduled-check", name, task: s.task });
    handled = !!reply?.handled;
  } catch {
    // No side panel is listening.
  }

  if (!handled) {
    chrome.notifications.create(`due:${name}:${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: `Scheduled check due: ${name}`,
      message: `Open the Gemini agent panel and start a session to run it. Task: ${String(s.task).slice(0, 120)}`,
    });
  }

  if (s.once) {
    delete schedules[name];
    await chrome.storage.local.set({ schedules });
  }
});
