import { Transcript, TranslationQueue } from './core.js';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['source','mode','prepare','start','stop','status','statusText','engine','privacy','sourceHint','compatibility','transcript','empty','scrollArea','copy','download','clear','benchmark','latency','time','wordCount','audioIndicator','liveBadge'].map(id => [id, $(id)]));
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const transcript = new Transcript(250);
const nodes = new Map();
const state = { ready: false, preparing: false, connecting: false, live: false, flushing: false, benchmarking: false, translator: null, recognizer: null, stream: null, recognitionId: 0, run: 0, restartTimer: null, flushTimer: null, clock: null, started: 0, quickEnds: 0, lastStart: 0 };
const chromeVersion = Number(navigator.userAgent.match(/(?:Chrome|Chromium)\/(\d+)/)?.[1] || 0);
const desktop = !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const support = { secure: window.isSecureContext, translation: 'Translator' in window, speech: !!Recognition, track: desktop && chromeVersion >= 135, capture: !!navigator.mediaDevices?.getDisplayMedia };

function status(message, tone = 'ready') {
  ui.statusText.textContent = message;
  ui.status.dataset.tone = tone;
}

function controls() {
  const occupied = state.live || state.connecting || state.flushing;
  ui.prepare.disabled = occupied || state.preparing || state.benchmarking || !support.translation || !support.speech || !support.secure;
  ui.prepare.textContent = state.preparing ? 'Preparando idiomas…' : state.ready ? '✓ Idiomas preparados' : '1. Preparar idiomas';
  ui.start.disabled = !state.ready || occupied || state.preparing || state.benchmarking;
  ui.start.textContent = state.connecting ? 'Selecciona el audio…' : '▶ 2. Conectar reunión';
  ui.stop.disabled = !occupied;
  ui.mode.disabled = occupied || state.preparing || state.benchmarking;
  ui.source.disabled = occupied || state.preparing || state.benchmarking;
  ui.benchmark.disabled = !state.ready || occupied || state.benchmarking;
  ui.copy.disabled = ui.download.disabled = ui.clear.disabled = transcript.rows.size === 0;
  ui.liveBadge.textContent = state.live ? 'EN VIVO' : state.flushing ? 'FINALIZANDO' : 'EN ESPERA';
  ui.liveBadge.classList.toggle('live', state.live);
}

function hint() {
  const sourceHints = {
    tab: 'Abre la reunión en otra pestaña. Al conectar, elígela y activa «Compartir audio de la pestaña».',
    system: 'En Windows, selecciona una pantalla completa y activa «Compartir audio del sistema» si Chrome lo ofrece. También puede captar notificaciones de otras aplicaciones.',
    mic: 'Esta opción escucha el micrófono. Para traducir a los participantes de una videollamada, elige el audio de la pestaña o de Windows.'
  };
  ui.sourceHint.textContent = sourceHints[ui.source.value];
  ui.privacy.textContent = ui.mode.value === 'local'
    ? 'En modo local, el audio y el texto se procesan en tu equipo. La primera preparación puede descargar paquetes de idioma.'
    : 'Al conectar en este modo, el audio se enviará al servicio de reconocimiento de Chrome. La traducción al español se procesa en tu equipo. Requiere internet.';
}

async function prepareSpeech() {
  if (ui.mode.value === 'online') return;
  const probe = new Recognition();
  if (!('processLocally' in probe) || typeof Recognition.available !== 'function' || typeof Recognition.install !== 'function') {
    throw new Error('El reconocimiento local no está disponible en este Chrome. Actualízalo o elige el servicio de voz de Chrome.');
  }
  const options = { langs: ['en-US'], processLocally: true };
  const availability = await Recognition.available(options);
  if (availability === 'unavailable') throw new Error('Chrome no ofrece el paquete local de inglés en este equipo. Puedes elegir el servicio de voz de Chrome.');
  if (availability !== 'available') {
    status('Descargando el paquete de voz en inglés. Mantén esta página abierta…', 'busy');
    const installed = await Recognition.install(options);
    if (!installed) throw new Error('No se pudo instalar el paquete de voz en inglés. Revisa tu conexión e inténtalo otra vez.');
  }
}

async function prepare() {
  if (ui.prepare.disabled) return;
  state.preparing = true;
  state.ready = false;
  status('Preparando inglés y español en tu navegador…', 'busy');
  controls();
  try {
    // Start model creation directly from the click, while user activation is valid.
    const translationJob = state.translator ? Promise.resolve(state.translator) : window.Translator.create({
      sourceLanguage: 'en', targetLanguage: 'es',
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', event => {
          const progress = event.loaded <= 1 ? Math.round(event.loaded * 100) : null;
          status(progress === null ? 'Descargando el traductor…' : `Descargando el traductor: ${progress} %`, 'busy');
        });
      }
    }).then(translator => { state.translator = translator; return translator; });
    const jobs = await Promise.allSettled([translationJob, prepareSpeech()]);
    const failed = jobs.find(job => job.status === 'rejected');
    if (failed) throw failed.reason;
    state.ready = true;
    ui.engine.textContent = ui.mode.value === 'local' ? 'Voz y traducción locales' : 'Voz en Chrome · traducción local';
    status('Listo. Pulsa Conectar reunión y selecciona el audio.');
  } catch (error) {
    status(errorMessage(error), 'error');
  } finally {
    state.preparing = false;
    controls();
  }
}

const queue = new TranslationQueue({
  translate: text => {
    if (!state.translator) throw new Error('Prepara el traductor antes de continuar.');
    return state.translator.translate(text);
  },
  onResult(result) {
    const row = transcript.apply(result);
    if (!row) return;
    renderRow(row);
    ui.latency.textContent = `${Math.round(result.elapsed)} ms`;
    ui.latency.title = 'Desde la recepción del texto reconocido hasta la traducción mostrada, incluida la espera. No mide audio → texto.';
  },
  onError(error, task) {
    const row = transcript.rows.get(task.id);
    if (!row || row.revision !== task.revision) return;
    row.error = 'No se pudo traducir este fragmento.';
    renderRow(row);
    status(`Se mantiene el inglés. ${errorMessage(error)}`, 'error');
  }
});

function renderRow(row) {
  const follow = ui.scrollArea.scrollHeight - ui.scrollArea.scrollTop - ui.scrollArea.clientHeight < 100;
  let refs = nodes.get(row.id);
  if (!refs) {
    const article = document.createElement('article');
    article.className = 'segment';
    const en = document.createElement('p');
    en.className = 'en'; en.lang = 'en';
    const es = document.createElement('p');
    es.className = 'es'; es.lang = 'es';
    article.append(en, es);
    refs = { article, en, es };
    nodes.set(row.id, refs);
    ui.transcript.append(article);
  }
  // Speech and translations are untrusted content: always use textContent.
  refs.en.textContent = row.en;
  refs.es.textContent = row.error || row.es || 'Traduciendo…';
  refs.es.classList.toggle('waiting', !row.es && !row.error);
  refs.article.classList.toggle('provisional', !row.final);
  refs.article.classList.toggle('partial', !!row.es && (!row.translatedFinal || row.translatedRevision < row.revision));
  refs.article.classList.toggle('failure', !!row.error);
  for (const [id, old] of nodes) {
    if (!transcript.rows.has(id)) { old.article.remove(); nodes.delete(id); }
  }
  ui.empty.hidden = true;
  ui.wordCount.textContent = `${[...transcript.rows.values()].reduce((total, item) => total + item.en.split(/\s+/).filter(Boolean).length, 0)} palabras`;
  if (follow) ui.scrollArea.scrollTop = ui.scrollArea.scrollHeight;
  controls();
}

function errorMessage(error) {
  if (error?.name === 'NotAllowedError') return 'No se concedió permiso para acceder al audio. Pulsa Conectar reunión cuando quieras intentarlo otra vez.';
  if (error?.name === 'NotFoundError') return 'No se encontró una fuente de audio disponible.';
  if (error?.name === 'NotSupportedError') return 'Esta función no está disponible en tu navegador. Usa Chrome actualizado para Windows.';
  return error?.message || 'No se pudo completar la operación. Inténtalo otra vez.';
}

function releaseStream() {
  state.stream?.getTracks().forEach(track => track.stop());
  state.stream = null;
}

function finishStop() {
  clearTimeout(state.flushTimer);
  state.flushing = false;
  state.recognizer = null;
  releaseStream();
  clearInterval(state.clock);
  ui.audioIndicator.textContent = '● Audio sin conectar';
  ui.audioIndicator.classList.remove('active');
  controls();
}

function stop(graceful = true, message = 'Audio detenido. El texto de esta sesión permanece en pantalla.') {
  state.live = false;
  state.connecting = false;
  state.run += 1; // Also cancels an outstanding capture chooser once it resolves.
  clearTimeout(state.restartTimer);
  if (graceful && state.recognizer) {
    state.flushing = true;
    status('Terminando el último fragmento…', 'busy');
    state.flushTimer = setTimeout(() => {
      state.recognizer?.abort();
      finishStop();
      status(message);
    }, 2000);
    try { state.recognizer.stop(); } catch { finishStop(); status(message); }
  } else {
    state.recognizer?.abort();
    finishStop();
    status(message, graceful ? 'ready' : 'error');
  }
  controls();
}

function recognize(track) {
  const id = ++state.recognitionId;
  const recognition = new Recognition();
  state.recognizer = recognition;
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  if (ui.mode.value === 'local') recognition.processLocally = true;
  recognition.onstart = () => {
    if (id !== state.recognitionId) return;
    state.lastStart = performance.now();
    ui.audioIndicator.textContent = '● Audio conectado';
    ui.audioIndicator.classList.add('active');
    status(ui.mode.value === 'local' ? 'Escuchando. El inglés y el español aparecerán mientras hablan.' : 'Escuchando con el servicio de voz de Chrome. Traducción local al español.');
  };
  recognition.onresult = event => {
    if (id !== state.recognitionId || (!state.live && !state.flushing)) return;
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index];
      const row = transcript.update(`${id}:${index}`, result[0].transcript, result.isFinal, performance.now());
      if (!row) continue;
      renderRow(row);
      queue.enqueue({ id: row.id, text: row.en, final: row.final, revision: row.revision, receivedAt: row.receivedAt });
    }
  };
  recognition.onerror = event => {
    if (id !== state.recognitionId || !state.live) return;
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    const reasons = {
      'not-allowed': 'Chrome denegó el permiso de reconocimiento de voz.',
      'service-not-allowed': 'El servicio de voz no está disponible. Prueba el reconocimiento en este equipo.',
      'audio-capture': 'Chrome no pudo reconocer el audio seleccionado. Prueba el audio de una pestaña en Chrome actualizado.',
      'language-not-supported': 'El paquete local de inglés no está disponible. Prepara los idiomas o cambia al servicio de voz de Chrome.',
      network: 'El servicio de voz perdió la conexión. Revisa internet o usa el modo local.'
    };
    stop(false, reasons[event.error] || `El reconocimiento se interrumpió (${event.error}).`);
  };
  recognition.onend = () => {
    if (id !== state.recognitionId) return;
    if (state.flushing) {
      finishStop();
      status('Audio detenido. El texto de esta sesión permanece en pantalla.');
    } else if (state.live && track.readyState === 'live') {
      state.quickEnds = performance.now() - state.lastStart < 800 ? state.quickEnds + 1 : 0;
      if (state.quickEnds > 3) {
        stop(false, 'Chrome cerró el reconocimiento varias veces. Prueba otro modo de voz o vuelve a conectar la pestaña.');
        return;
      }
      state.restartTimer = setTimeout(() => {
        if (!state.live || track.readyState !== 'live') return;
        try { recognize(track); } catch (error) { stop(false, errorMessage(error)); }
      }, 200);
    } else if (state.live) stop(false, 'Se terminó la fuente de audio. Vuelve a conectar la reunión.');
  };
  state.lastStart = performance.now();
  // Chrome 135+ accepts a MediaStreamTrack. Never silently fall back to the mic.
  recognition.start(track);
}

async function start() {
  if (ui.start.disabled) return;
  if (ui.source.value !== 'mic' && (!support.track || !support.capture)) {
    status('La captura de reuniones requiere Chrome de escritorio actualizado (135 o posterior).', 'error');
    return;
  }
  const run = ++state.run;
  state.connecting = true;
  status('Selecciona la fuente y activa Compartir audio en el selector de Chrome.', 'busy');
  controls();
  try {
    const stream = ui.source.value === 'mic'
      ? await navigator.mediaDevices.getUserMedia({ audio: true })
      : await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: ui.source.value === 'system' ? 'monitor' : 'browser' },
        audio: { suppressLocalAudioPlayback: false },
        preferCurrentTab: false, selfBrowserSurface: 'exclude', systemAudio: 'include', surfaceSwitching: 'exclude'
      });
    if (!state.connecting || run !== state.run) { stream.getTracks().forEach(track => track.stop()); return; }
    state.stream = stream;
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('No se recibió audio. Selecciona de nuevo la pestaña o la pantalla y activa Compartir audio.');
    state.live = true;
    state.connecting = false;
    state.quickEnds = 0;
    state.started = performance.now();
    ui.time.textContent = '00:00';
    state.clock = setInterval(() => {
      const seconds = Math.floor((performance.now() - state.started) / 1000);
      ui.time.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }, 1000);
    track.addEventListener('ended', () => { if (state.live) stop(true); });
    stream.getVideoTracks().forEach(video => video.addEventListener('ended', () => { if (state.live) stop(true); }));
    recognize(track);
  } catch (error) {
    if (run === state.run) stop(false, errorMessage(error));
  } finally {
    if (run === state.run) state.connecting = false;
    controls();
  }
}

async function benchmark() {
  if (ui.benchmark.disabled) return;
  state.benchmarking = true;
  controls();
  status('Midiendo solo la traducción de texto. No se capta audio.', 'busy');
  try {
    const samples = ['Good morning. Thank you for joining the meeting.', 'We are working on artificial intelligence for health.', 'Could you explain the results of the project?'];
    let total = 0;
    for (const sample of samples) {
      const started = performance.now();
      await state.translator.translate(sample);
      total += performance.now() - started;
    }
    ui.latency.textContent = `${Math.round(total / samples.length)} ms`;
    ui.latency.title = 'Promedio de tres traducciones de texto. No incluye reconocimiento ni captura de audio.';
    status('Prueba terminada: promedio de tres traducciones de texto. El retraso desde el audio sigue pendiente de medir.');
  } catch (error) { status(errorMessage(error), 'error'); }
  finally { state.benchmarking = false; controls(); }
}

ui.prepare.addEventListener('click', prepare);
ui.start.addEventListener('click', start);
ui.stop.addEventListener('click', () => stop(true));
ui.benchmark.addEventListener('click', benchmark);
ui.source.addEventListener('change', hint);
ui.mode.addEventListener('change', () => { state.ready = false; hint(); controls(); status('Prepara de nuevo los idiomas para el modo seleccionado.'); });
ui.copy.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(transcript.exportText()); status('Texto copiado.'); }
  catch { status('Chrome no permitió copiar. Puedes usar Descargar.', 'error'); }
});
ui.download.addEventListener('click', () => {
  const text = `EntreLíneas · Inglés → español\n${new Date().toLocaleString('es-PE')}\n\n${transcript.exportText()}`;
  const url = URL.createObjectURL(new Blob(['\ufeff', text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `entrelineas-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
ui.clear.addEventListener('click', () => {
  queue.reset(); transcript.clear(); nodes.clear(); ui.transcript.replaceChildren();
  ui.empty.hidden = false; ui.wordCount.textContent = '0 palabras'; ui.latency.textContent = '— ms';
  controls();
});
window.addEventListener('pagehide', () => {
  state.live = state.flushing = state.connecting = false;
  state.run += 1;
  state.recognitionId += 1;
  state.recognizer?.abort(); releaseStream(); queue.reset();
  clearTimeout(state.restartTimer); clearTimeout(state.flushTimer); clearInterval(state.clock);
  state.translator?.destroy(); state.translator = null; state.ready = false;
  controls();
});

hint(); controls();
ui.compatibility.textContent = `Chrome detectado: ${chromeVersion || 'otro navegador'} · Traductor local: ${support.translation ? 'disponible' : 'no disponible'} · Voz: ${support.speech ? 'disponible' : 'no disponible'} · Audio de pestaña: ${support.track && support.capture ? 'compatible' : 'no compatible'}.`;
if (!support.secure) status('Abre esta página por HTTPS, por ejemplo desde GitHub Pages. No funciona al abrir el archivo HTML directamente.', 'error');
else if (!desktop) status('Esta versión está preparada para Chrome de escritorio en Windows. Ábrela en tu laptop.', 'error');
else if (!support.translation || !support.speech) status('Faltan funciones de voz o traducción en este navegador. Usa Chrome actualizado para Windows y vuelve a abrir la página.', 'error');
else status('Pulsa Preparar idiomas. Después podrás conectar el audio de Zoom o Meet.');
