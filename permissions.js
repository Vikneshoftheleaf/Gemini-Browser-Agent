const msg = document.getElementById("msg");

document.getElementById("allow").addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    msg.textContent = "Microphone allowed. You can close this tab and tap the mic in the side panel.";
    setTimeout(() => window.close(), 1200);
  } catch (e) {
    msg.textContent = `Access was not granted (${e.name}). Allow the microphone in the address bar's site settings, then try again.`;
  }
});
