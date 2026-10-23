import test from 'node:test';
import assert from 'node:assert/strict';

// In-memory API doubles exercise capture/recognition lifecycle, not a browser.
class Element {
  constructor() { this.listeners = {}; this.children = []; this.dataset = {}; this.value = ''; this.disabled = false; this.classList = { toggle() {}, add() {}, remove() {} }; this.scrollHeight = this.clientHeight = 300; this.scrollTop = 0; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  async fire(type) { return this.listeners[type]?.(); }
  append(...elements) { elements.forEach(element => { element.parent = this; this.children.push(element); }); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); }
  replaceChildren() { this.children = []; }
}

async function fixture({ withAudio = true } = {}) {
  const ids = ['source','mode','prepare','start','stop','status','statusText','engine','privacy','sourceHint','compatibility','transcript','empty','scrollArea','copy','download','clear','benchmark','latency','time','wordCount','audioIndicator','liveBadge'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  elements.source.value = 'tab'; elements.mode.value = 'local';
  const pageEvents = {};
  const track = { kind: 'audio', readyState: 'live', stops: 0, addEventListener() {}, stop() { this.stops++; this.readyState = 'ended'; } };
  const video = { kind: 'video', readyState: 'live', addEventListener() {}, stop() { this.readyState = 'ended'; } };
  let captureOptions, microphoneCalls = 0;
  const recognitions = [];
  class Recognition {
    constructor() { this.processLocally = false; recognitions.push(this); }
    static async available() { return 'available'; }
    static async install() { return true; }
    start(input) { this.input = input; this.onstart?.(); }
    emit(text, final) {
      const result = [{ transcript: text }]; result.isFinal = final;
      this.onresult?.({ resultIndex: 0, results: [result] });
    }
    stop() { this.emit('The meeting is ready.', true); this.onend?.(); }
    abort() { this.onend?.(); }
  }
  const replacements = {
    window: { isSecureContext: true, SpeechRecognition: Recognition, Translator: { async create() { return { async translate(text) { return `ES ${text}`; }, destroy() {} }; } }, addEventListener(type, listener) { pageEvents[type] = listener; } },
    document: { getElementById: id => elements[id], createElement: () => new Element(), body: new Element() },
    navigator: { userAgent: 'Chrome/150.0 Windows', mediaDevices: {
      async getDisplayMedia(options) { captureOptions = options; return { getAudioTracks: () => withAudio ? [track] : [], getVideoTracks: () => [video], getTracks: () => withAudio ? [track, video] : [video] }; },
      async getUserMedia() { microphoneCalls++; throw new Error('unexpected microphone access'); }
    } }
  };
  const originals = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { value, configurable: true });
  await import(`../docs/app.js?test=${Math.random()}`);
  return { elements, track, video, recognitions, capture: () => captureOptions, microphones: () => microphoneCalls,
    cleanup() {
      pageEvents.pagehide?.();
      for (const key of Object.keys(replacements)) {
        if (originals[key]) Object.defineProperty(globalThis, key, originals[key]);
        else delete globalThis[key];
      }
    }
  };
}

test('meeting audio is passed to recognition and stopping preserves the final recognized phrase', async () => {
  const f = await fixture();
  try {
    await f.elements.prepare.fire('click');
    assert.equal(f.elements.start.disabled, false);
    await f.elements.start.fire('click');
    const recognition = f.recognitions.at(-1);
    assert.equal(recognition.input, f.track);
    assert.equal(recognition.processLocally, true);
    assert.equal(f.microphones(), 0);
    assert.equal(f.capture().audio.suppressLocalAudioPlayback, false);
    await f.elements.stop.fire('click');
    await new Promise(resolve => setImmediate(resolve));
    const row = f.elements.transcript.children[0];
    assert.equal(row.children[0].textContent, 'The meeting is ready.');
    assert.equal(row.children[1].textContent, 'ES The meeting is ready.');
    assert.equal(f.track.readyState, 'ended');
    assert.equal(f.elements.stop.disabled, true);
    assert.equal(f.elements.start.disabled, false);
  } finally { f.cleanup(); }
});

test('sharing without audio stops capture and never substitutes the microphone', async () => {
  const f = await fixture({ withAudio: false });
  try {
    await f.elements.prepare.fire('click');
    await f.elements.start.fire('click');
    assert.match(f.elements.statusText.textContent, /No se recibió audio/);
    assert.equal(f.video.readyState, 'ended');
    assert.equal(f.microphones(), 0);
    assert.equal(f.elements.stop.disabled, true);
    assert.equal(f.elements.start.disabled, false);
  } finally { f.cleanup(); }
});
