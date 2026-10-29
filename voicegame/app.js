/* REWIND! 🎙️ Minimal original/reverse voice studio. All recordings stay on-device. */
(() => {
  'use strict';

  const el = id => document.getElementById(id);
  const studio = document.querySelector('.studio');
  const recordButton = el('recordButton');
  const playOriginal = el('playOriginal');
  const playReverse = el('playReverse');
  const canvas = el('waveform');
  const graphics = canvas.getContext('2d');
  const MAX_SECONDS = 15;
  const reactions = ['😂', '🤯', '😝', '👽', '🦄', '🐸', '🥳', '🐵', '😎'];
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;

  let state = 'idle';
  let audioBuffer = null;
  let audioContext = null;
  let source = null;
  let playing = '';
  let recorder = null;
  let stream = null;
  let micInput = null;
  let analyser = null;
  let samples = null;
  let chunks = [];
  let recordStart = 0;
  let interval = 0;
  let reaction = '🎙️';
  let lastFrame = 0;

  // Remove stored nickname/ranking information left by the older version.
  try { localStorage.removeItem('voicegame-local-profiles-v2'); } catch (_) { /* Storage may be disabled. */ }

  function setError(message = '') {
    const box = el('errorMessage');
    box.textContent = message;
    box.hidden = !message;
  }
  function getContext() {
    if (!audioContext) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error('Tu navegador no admite esta función de audio.');
      audioContext = new Context();
    }
    return audioContext;
  }
  function toTime(t) {
    const n = Math.floor(Math.max(0, t));
    return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  }
  function stopPlayback() {
    const last = source;
    source = null;
    playing = '';
    if (last) {
      last.onended = null;
      try { last.stop(); } catch (_) { /* Source may have already finished. */ }
      try { last.disconnect(); } catch (_) {}
    }
  }
  function disposeMicrophone() {
    if (micInput) { try { micInput.disconnect(); } catch (_) {} micInput = null; }
    if (analyser) { try { analyser.disconnect(); } catch (_) {} analyser = null; }
    if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null; }
    samples = null;
  }
  function reverseAudio(buffer) {
    const ctx = getContext();
    const flipped = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const original = buffer.getChannelData(channel);
      const backwards = flipped.getChannelData(channel);
      for (let i = 0, n = original.length; i < n; i++) backwards[i] = original[n - 1 - i];
    }
    return flipped;
  }
  function updateInterface() {
    const recording = state === 'recording', processing = state === 'processing', ready = state === 'ready';
    studio.classList.toggle('is-recording', recording);
    recordButton.disabled = processing;
    recordButton.setAttribute('aria-pressed', String(recording));
    recordButton.setAttribute('aria-label', recording ? 'Detener grabación' : ready ? 'Grabar un audio nuevo' : 'Empezar grabación');
    el('recordSymbol').textContent = recording ? '⏹️' : ready ? '🔄' : '🎙️';
    el('recordText').textContent = recording ? 'DETENER' : processing ? 'PROCESANDO' : ready ? 'OTRA VEZ' : 'GRABAR';
    el('micHint').textContent = recording ? '🔴 Grabando… toca para detener' : processing ? '✨ Preparando tu audio…' : ready ? '🔁 Toca el botón grande para grabar otra vez' : '👆 Toca para empezar · Máximo 15 segundos';
    el('statusLabel').textContent = recording ? 'GRABANDO TU VOZ' : processing ? 'PREPARANDO AUDIO' : ready ? 'AUDIO PREPARADO' : 'LISTO PARA GRABAR';
    el('clock').textContent = recording ? '00:00 / 00:15' : ready && audioBuffer ? toTime(audioBuffer.duration) : '00:00';
    el('playPanel').hidden = !ready;
    playOriginal.disabled = !ready;
    playReverse.disabled = !ready;
    playOriginal.setAttribute('aria-pressed', String(playing === 'original'));
    playReverse.setAttribute('aria-pressed', String(playing === 'reverse'));
    el('iconOriginal').textContent = playing === 'original' ? '⏹️' : '▶️';
    el('labelOriginal').textContent = playing === 'original' ? 'Detener' : 'Original';
    el('iconReverse').textContent = playing === 'reverse' ? '⏹️' : '⏪';
    el('labelReverse').textContent = playing === 'reverse' ? 'Detener' : 'Reversa';

    const emoji = recording ? '🔴' : processing ? '✨' : playing === 'reverse' ? '🤪' : playing === 'original' ? '🎧' : ready ? reaction : '🎙️';
    const icon = el('reaction');
    if (icon.textContent !== emoji) {
      icon.textContent = emoji;
      icon.classList.remove('pop');
      // Trigger the small entrance animation on each new reaction.
      if (!reduceMotion) { void icon.offsetWidth; icon.classList.add('pop'); }
    }
    el('studioTitle').textContent = recording ? '¡Te escucho! 🎤' : processing ? '¡Un momento! ✨' : playing === 'reverse' ? '¡Así suenas al revés! 🤪' : playing === 'original' ? '¡Esta es tu voz! 🎧' : ready ? '¡Ya lo tienes! 🎉' : '¡Tu voz, tu momento!';
    el('studioSubtitle').textContent = recording ? 'Di algo divertido. Puedes detenerlo cuando quieras.' : processing ? 'Preparando el audio para reproducirlo…' : playing === 'reverse' ? '¿Quién diría que eres tú? 😂' : playing === 'original' ? 'Así quedó tu grabación original.' : ready ? 'Prueba los dos botones y sorpréndete.' : 'Pulsa el botón y di lo que quieras.';
  }
  async function startRecording() {
    if (state === 'processing' || state === 'recording') return;
    setError();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Necesitas abrir la web con HTTPS desde Safari o Chrome y permitir el micrófono.');
      return;
    }
    stopPlayback();
    updateInterface();
    recordButton.disabled = true;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }, video: false
      });
      stream = fresh;
      const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
      const mimeType = types.find(type => MediaRecorder.isTypeSupported?.(type));
      const session = mimeType ? new MediaRecorder(fresh, { mimeType }) : new MediaRecorder(fresh);
      chunks = [];
      session.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      session.onerror = () => {
        setError('Ocurrió un error de grabación. Inténtalo de nuevo.');
        if (session.state === 'recording') { try { session.stop(); } catch (_) {} }
      };
      session.onstop = async () => {
        clearInterval(interval);
        recorder = null;
        disposeMicrophone();
        state = 'processing';
        updateInterface();
        try {
          if (!chunks.length) throw new Error('No se ha grabado audio. Prueba otra vez.');
          const blob = new Blob(chunks, { type: session.mimeType || mimeType || chunks[0].type });
          const decoded = await getContext().decodeAudioData(await blob.arrayBuffer());
          if (decoded.duration < .18) throw new Error('La grabación es demasiado corta. Habla un poquito más.');
          audioBuffer = decoded;
          buildPeaks();
          reaction = reactions[Math.floor(Math.random() * reactions.length)];
          state = 'ready';
          setError();
        } catch (error) {
          audioBuffer = null;
          state = 'idle';
          setError('No se pudo preparar el audio: ' + (error?.message || 'Prueba de nuevo.'));
        } finally {
          chunks = [];
          updateInterface();
        }
      };
      recorder = session;
      audioBuffer = null;
      playing = '';
      state = 'recording';
      session.start(250);
      recordStart = performance.now();
      try {
        const ctx = getContext();
        micInput = ctx.createMediaStreamSource(fresh);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        micInput.connect(analyser); // No speakers: prevents live microphone feedback.
        samples = new Uint8Array(analyser.fftSize);
      } catch (_) { /* Visualizer is optional. */ }
      updateInterface();
      interval = window.setInterval(() => {
        if (state !== 'recording') return;
        const seconds = (performance.now() - recordStart) / 1000;
        el('clock').textContent = toTime(seconds) + ' / 00:15';
        if (seconds >= MAX_SECONDS) stopRecording();
      }, 100);
    } catch (error) {
      recorder = null;
      disposeMicrophone();
      state = audioBuffer ? 'ready' : 'idle';
      if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') setError('🎙️ Permite el micrófono en los ajustes de tu navegador e inténtalo de nuevo.');
      else if (error?.name === 'NotFoundError') setError('No se ha encontrado un micrófono disponible.');
      else setError('No se puede iniciar la grabación: ' + (error?.message || 'Error desconocido.'));
      updateInterface();
    } finally { if (state !== 'processing') recordButton.disabled = false; }
  }
  function stopRecording() {
    if (state !== 'recording' || !recorder) return;
    clearInterval(interval);
    try {
      recorder.stop();
      state = 'processing';
      updateInterface();
    } catch (error) {
      recorder = null;
      disposeMicrophone();
      state = 'idle';
      setError('Error al detener la grabación. Vuelve a intentarlo.');
      updateInterface();
    }
  }
  async function playAudio(which) {
    if (state !== 'ready' || !audioBuffer) return;
    if (playing === which) { stopPlayback(); updateInterface(); return; }
    stopPlayback();
    try {
      const ctx = getContext();
      await ctx.resume();
      const node = ctx.createBufferSource();
      node.buffer = which === 'reverse' ? reverseAudio(audioBuffer) : audioBuffer;
      node.connect(ctx.destination);
      source = node;
      playing = which;
      node.onended = () => {
        if (source !== node) return;
        node.disconnect();
        source = null;
        playing = '';
        updateInterface();
      };
      node.start();
      updateInterface();
    } catch (error) {
      stopPlayback();
      setError('No se pudo reproducir: ' + (error?.message || 'Inténtalo de nuevo.'));
      updateInterface();
    }
  }

  let barLevels = Array(55).fill(0);
  function resizeVisualizer() {
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(200, Math.round(bounds.width * ratio));
    canvas.height = Math.max(70, Math.round(bounds.height * ratio));
    if (audioBuffer) buildPeaks();
  }
  function buildPeaks() {
    if (!audioBuffer) return;
    const data = audioBuffer.getChannelData(0);
    const bars = barLevels.length;
    const range = Math.max(1, Math.floor(data.length / bars));
    barLevels = barLevels.map((_, i) => {
      let peak = 0;
      const from = i * range, end = Math.min(data.length, (i + 1) * range);
      const stride = Math.max(1, Math.floor((end - from) / 80));
      for (let j = from; j < end; j += stride) peak = Math.max(peak, Math.abs(data[j]));
      return Math.max(.055, Math.min(1, peak * 2));
    });
  }
  function draw(t) {
    if (t - lastFrame >= 35 && !document.hidden && graphics) {
      lastFrame = t;
      const w = canvas.width, h = canvas.height, count = barLevels.length, space = w / count;
      graphics.clearRect(0, 0, w, h);
      const gradient = graphics.createLinearGradient(0, 0, w, 0);
      gradient.addColorStop(0, '#fd78c3');
      gradient.addColorStop(.5, '#bb96ff');
      gradient.addColorStop(1, '#69e6d3');
      graphics.fillStyle = gradient;
      let loudness = 0;
      if (analyser && samples && state === 'recording') {
        analyser.getByteTimeDomainData(samples);
        for (let i = 0; i < samples.length; i++) loudness += ((samples[i] - 128) / 128) ** 2;
        loudness = Math.min(1, Math.sqrt(loudness / samples.length) * 5);
      }
      for (let i = 0; i < count; i++) {
        const idle = .10 + .18 * (Math.sin(i * .50) ** 2) + .13 * Math.abs(Math.sin(i * .17 + t / 1200));
        const level = state === 'recording' ? Math.max(.08, loudness * (.45 + .5 * Math.abs(Math.sin(i * .42 + t / 320)))) :
          state === 'ready' && audioBuffer ? barLevels[i] * (playing ? (.78 + .17 * Math.sin(i*.3 + t/220)) : 1) : idle;
        const height = Math.max(4, Math.min(.94, level) * h * .79);
        const width = Math.max(2.5, space * .46);
        const x = (i + .5) * space - width / 2;
        graphics.beginPath();
        if (graphics.roundRect) graphics.roundRect(x, (h - height) / 2, width, height, width / 2);
        else graphics.rect(x, (h - height) / 2, width, height);
        graphics.fill();
      }
    }
    if (!reduceMotion || state === 'recording' || playing) requestAnimationFrame(draw);
  }

  recordButton.addEventListener('click', () => state === 'recording' ? stopRecording() : startRecording());
  playOriginal.addEventListener('click', () => playAudio('original'));
  playReverse.addEventListener('click', () => playAudio('reverse'));
  window.addEventListener('resize', resizeVisualizer);
  window.addEventListener('pagehide', () => { clearInterval(interval); stopPlayback(); disposeMicrophone(); });
  if ('ResizeObserver' in window) new ResizeObserver(resizeVisualizer).observe(canvas);
  resizeVisualizer();
  updateInterface();
  requestAnimationFrame(draw);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();