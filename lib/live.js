// Minimal Gemini Live API client over a raw WebSocket (no SDK bundling needed in MV3).
//
// Protocol summary:
//   client -> { setup: {...} }                                 first message
//   server -> { setupComplete: {} }
//   client -> { realtimeInput: { audio | video | text } }      streaming input
//   server -> { serverContent: { modelTurn, turnComplete, interrupted, inputTranscription, outputTranscription } }
//   server -> { toolCall: { functionCalls: [{ id, name, args }] } }
//   client -> { toolResponse: { functionResponses: [{ id, name, response }] } }
//   server -> { sessionResumptionUpdate, goAway }

const ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export class LiveClient {
  /**
   * @param {object} o
   * @param {string} o.apiKey
   * @param {string} o.model                e.g. "gemini-3.1-flash-live-preview"
   * @param {string} o.systemInstruction
   * @param {Array}  o.tools                [{ functionDeclarations: [...] }]
   * @param {string} [o.voice]
   * @param {string} [o.thinkingLevel]      "minimal" | "low" | "medium" | "high" | "" (omit)
   * @param {boolean}[o.longSession]        enables context compression + session resumption
   * @param {object} handlers               onReady, onAudio, onText, onToolCall, onInterrupted,
   *                                        onTurnComplete, onUserTranscript, onModelTranscript,
   *                                        onClose, onError, onGoAway
   */
  constructor(o, handlers) {
    this.o = o;
    this.h = handlers;
    this.ws = null;
    this.ready = false;
    this.resumeHandle = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `${ENDPOINT}?key=${encodeURIComponent(this.o.apiKey)}`;
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => this._send({ setup: this._buildSetup() });

      ws.onmessage = async (ev) => {
        let raw = ev.data;
        if (raw instanceof Blob) raw = await raw.text();
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        this._handle(msg, resolve);
      };

      ws.onerror = () => {
        const err = new Error("WebSocket error (check your API key and network)");
        this.h.onError?.(err);
        reject(err);
      };

      ws.onclose = (ev) => {
        const wasReady = this.ready;
        this.ready = false;
        if (!wasReady) reject(new Error(`Closed before ready: ${ev.code} ${ev.reason || ""}`.trim()));
        this.h.onClose?.(ev);
      };
    });
  }

  _buildSetup() {
    const { model, systemInstruction, tools, voice, thinkingLevel, longSession } = this.o;
    const setup = {
      model: model.startsWith("models/") ? model : `models/${model}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: voice
          ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
          : undefined,
      },
      systemInstruction: { parts: [{ text: systemInstruction }] },
      tools,
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    };
    if (thinkingLevel) setup.generationConfig.thinkingConfig = { thinkingLevel };
    if (longSession) {
      setup.contextWindowCompression = { slidingWindow: {} };
      setup.sessionResumption = this.resumeHandle ? { handle: this.resumeHandle } : {};
    }
    return setup;
  }

  _handle(msg, onSetupDone) {
    if (msg.setupComplete) {
      this.ready = true;
      this.h.onReady?.();
      onSetupDone?.();
      return;
    }

    if (msg.toolCall?.functionCalls) {
      this.h.onToolCall?.(msg.toolCall.functionCalls);
      return;
    }

    if (msg.toolCallCancellation) {
      this.h.onToolCancel?.(msg.toolCallCancellation.ids || []);
      return;
    }

    if (msg.sessionResumptionUpdate?.newHandle) {
      this.resumeHandle = msg.sessionResumptionUpdate.newHandle;
    }

    if (msg.goAway) this.h.onGoAway?.(msg.goAway.timeLeft);

    const sc = msg.serverContent;
    if (!sc) return;

    if (sc.interrupted) this.h.onInterrupted?.();
    if (sc.inputTranscription?.text) this.h.onUserTranscript?.(sc.inputTranscription.text);
    if (sc.outputTranscription?.text) this.h.onModelTranscript?.(sc.outputTranscription.text);

    for (const part of sc.modelTurn?.parts || []) {
      if (part.inlineData?.data) this.h.onAudio?.(part.inlineData.data);
      else if (part.text && !part.thought) this.h.onText?.(part.text);
    }

    if (sc.turnComplete) this.h.onTurnComplete?.();
  }

  _send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  sendAudio(base64Pcm16) {
    if (!this.ready) return;
    this._send({ realtimeInput: { audio: { data: base64Pcm16, mimeType: "audio/pcm;rate=16000" } } });
  }

  sendImage(base64Jpeg) {
    if (!this.ready) return;
    this._send({ realtimeInput: { video: { data: base64Jpeg, mimeType: "image/jpeg" } } });
  }

  sendText(text) {
    if (!this.ready) return;
    this._send({ realtimeInput: { text } });
  }

  sendToolResponse(functionResponses) {
    this._send({ toolResponse: { functionResponses } });
  }

  close() {
    this.ready = false;
    try { this.ws?.close(1000, "client closing"); } catch {}
  }
}
