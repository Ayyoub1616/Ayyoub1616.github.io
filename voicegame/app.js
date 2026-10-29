/* REWIND! — audio processing happens locally; no microphone data is sent to a server. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const phrases = [
    'La vaca cósmica baila salsa', 'Mi gato sabe hablar marciano',
    'Tres tristes tigres comen tacos', 'Soy el rey de las croquetas',
    'El plátano volador está loco', '¡Qué fresquita está la limonada!',
    'Mañana me compro un dragón', 'La pizza me está mirando',
    '¿Quién se ha comido mi bocadillo?', 'Me gustan los lunes de fiesta',
    'El unicornio tiene patinete', 'Chocolate con churros para todos',
    'Mi abuela es una estrella del rock', 'El loro canta reguetón',
    'Paco pica pocas papas', 'Las ranas llevan gafas de sol',
    'Nunca subestimes a una tostadora', 'La patata se fue de vacaciones',
    'Hoy voy a ganar este desafío', 'Una jirafa juega al baloncesto',
  ];
  const recordLimit = 12;
  let round = 1;
  let step = 'original';
  let mode = 'challenge';
  let original = null;
  let attempt = null;
  let imported = null;
  let ctx = null;
  let recorder = null;
  let stream = null;
  let sourceNode = null;
  let currentPlayingKey = '';
  let recordKind = '';
  let startedAt = 0;
  let elapsed = 0;
  let tick = 0;
  let micAnalyser = null;
  let micSource = null;
  let micWaveTick = 0;
  let playingBarsFrame = 0;
  let lastError = '';
  let phraseIndex = 0;
  let busy = false;

  const canvas = $('waveform');
  const painter = canvas.getContext('2d');

  function getContext() {
    if (!ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Este navegador no admite Web Audio. Prueba con Safari, Chrome o Firefox actualizado.');
      ctx = new AudioContextClass();
    }
    return ctx;
  }

  function setError(message, target = 'error-bar') {
    const bar = $(target);
    bar.hidden = !message;
    bar.textContent = message || '';
    lastError = message || '';
  }

  function timeLabel(sec) {
    const value = Math.floor(Math.max(0, sec));
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }

  function setWaveMeta(label, timeText) {
    $('wave-label').textContent = label;
    $('time-counter').textContent = timeText;
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpi = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(100, Math.round(rect.width * dpi));
    canvas.height = Math.round(rect.height * dpi);
    drawWave(currentBufferForWave());
  }

  function currentBufferForWave() {
    if (step === 'result' && attempt) return attempt;
    if ((step === 'listen' || step === 'attempt') && original) return original;
    return null;
  }

  function drawWave(buffer = null, live = null) {
    if (!painter) return;
    const w = canvas.width;
    const h = canvas.height;
    const n = 65;
    const spacing = w / n;
    painter.clearRect(0, 0, w, h);
    const gradient = painter.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, '#ff659a');
    gradient.addColorStop(.52, '#b37cff');
    gradient.addColorStop(1, '#56e8c4');
    painter.fillStyle = gradient;
    const channel = buffer ? buffer.getChannelData(0) : null;
    for (let i = 0; i < n; i++) {
      let amplitude = 0;
      if (live) {
        const start = Math.floor(i * live.length / n);
        const end = Math.floor((i + 1) * live.length / n);
        for (let j = start; j < end; j++) amplitude = Math.max(amplitude, Math.abs((live[j] - 128) / 128));
        amplitude = Math.min(1, amplitude * 2.7);
      } else if (channel) {
        const start = Math.floor(i * channel.length / n);
        const end = Math.floor((i + 1) * channel.length / n);
        const stride = Math.max(1, Math.ceil((end - start) / 60));
        for (let j = start; j < end; j += stride) amplitude = Math.max(amplitude, Math.abs(channel[j]));
        amplitude = Math.min(1, amplitude * 1.5);
      } else {
        amplitude = .10 + .08 * Math.sin(i * .72) ** 2 + .19 * Math.exp(-(((i - 32) / 21) ** 2)) * Math.abs(Math.sin(i * .48));
      }
      const bh = Math.max(4, amplitude * h * .85);
      const bw = Math.max(3, spacing * .43);
      const x = i * spacing + (spacing - bw) / 2;
      const y = (h - bh) / 2;
      painter.beginPath();
      painter.roundRect(x, y, bw, bh, bw / 2);
      painter.fill();
    }
  }

  function startMicMeter(mediaStream) {
    try {
      const audioContext = getContext();
      micSource = audioContext.createMediaStreamSource(mediaStream);
      micAnalyser = audioContext.createAnalyser();
      micAnalyser.fftSize = 2048;
      micSource.connect(micAnalyser); // No output connection: don't echo the microphone.
      const data = new Uint8Array(micAnalyser.fftSize);
      function animate() {
        if (!recorder || recorder.state !== 'recording' || !micAnalyser) return;
        micAnalyser.getByteTimeDomainData(data);
        drawWave(null, data);
        micWaveTick = requestAnimationFrame(animate);
      }
      animate();
    } catch (_) { /* Meter is optional; recording still works. */ }
  }

  function stopMicMeter() {
    cancelAnimationFrame(micWaveTick);
    micSource?.disconnect();
    micAnalyser?.disconnect();
    micSource = null;
    micAnalyser = null;
  }

  function disposeStream() {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    stopMicMeter();
  }

  function chooseMimeType() {
    const allowed = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    return allowed.find(type => MediaRecorder.isTypeSupported?.(type)) || '';
  }

  function stopPlayback() {
    if (sourceNode) {
      const old = sourceNode;
      sourceNode = null;
      old.onended = null;
      try { old.stop(); } catch (_) { /* Already stopped. */ }
      old.disconnect();
    }
    currentPlayingKey = '';
  }

  async function play(buffer, key, inverted = false) {
    if (!buffer) return;
    if (currentPlayingKey === key) {
      stopPlayback();
      renderControls();
      return;
    }
    stopPlayback();
    try {
      const audioContext = getContext();
      await audioContext.resume();
      const output = audioContext.createBufferSource();
      output.buffer = inverted ? reverseBuffer(buffer) : buffer;
      output.connect(audioContext.destination);
      sourceNode = output;
      currentPlayingKey = key;
      output.onended = () => {
        if (sourceNode !== output) return;
        sourceNode = null;
        currentPlayingKey = '';
        renderControls();
      };
      output.start(0);
      renderControls();
    } catch (error) {
      setError('No se pudo reproducir el audio: ' + (error?.message || 'error desconocido'));
    }
  }

  function reverseBuffer(buffer) {
    const audioContext = getContext();
    const out = audioContext.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = out.getChannelData(ch);
      for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - i - 1];
    }
    return out;
  }

  async function beginRecording(kind) {
    if (busy || recorder || !['original', 'attempt'].includes(kind)) return;
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Tu navegador no permite grabar aquí. Abre el juego desde una web HTTPS en Safari o Chrome y autoriza el micrófono.');
      return;
    }
    stopPlayback();
    busy = true;
    $('record-btn').disabled = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      const preferred = chooseMimeType();
      const options = preferred ? { mimeType: preferred } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      const chunks = [];
      recordKind = kind;
      mediaRecorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
      mediaRecorder.onerror = () => { setError('Hubo un problema al grabar. Prueba de nuevo.'); };
      mediaRecorder.onstop = async () => {
        clearInterval(tick);
        const kindFinished = recordKind;
        recordKind = '';
        recorder = null;
        disposeStream();
        busy = true;
        try {
          if (!chunks.length) throw new Error('La grabación ha quedado vacía. Prueba a hablar durante más tiempo.');
          const type = mediaRecorder.mimeType || preferred || chunks[0].type;
          const raw = new Blob(chunks, { type });
          const decoded = await getContext().decodeAudioData(await raw.arrayBuffer());
          if (decoded.duration < .25) throw new Error('La grabación ha sido demasiado corta. Inténtalo otra vez.');
          if (kindFinished === 'original') {
            original = decoded;
            step = 'listen';
          } else {
            attempt = decoded;
            step = 'result';
          }
          elapsed = 0;
          setError('');
        } catch (error) {
          setError(error.message || 'No se pudo procesar este audio. Vuelve a intentarlo.');
        } finally {
          busy = false;
          render();
        }
      };
      recorder = mediaRecorder;
      startedAt = Date.now();
      elapsed = 0;
      mediaRecorder.start(250);
      busy = false;
      $('record-btn').disabled = false;
      startMicMeter(stream);
      updateRecordView();
      tick = setInterval(() => {
        elapsed = Math.min(recordLimit, (Date.now() - startedAt) / 1000);
        setWaveMeta('🔴 Grabando…', `${timeLabel(elapsed)} / 00:12`);
        if (elapsed >= recordLimit) endRecording();
      }, 120);
    } catch (error) {
      busy = false;
      recorder = null;
      disposeStream();
      $('record-btn').disabled = false;
      let message = 'No pudimos acceder al micrófono.';
      if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
        message = 'Permiso de micrófono denegado. Actívalo desde los ajustes del navegador y vuelve a intentarlo.';
      } else if (error?.name === 'NotFoundError') {
        message = 'No se ha encontrado un micrófono en el dispositivo.';
      } else if (error?.message) {
        message = error.message;
      }
      setError(message);
      updateRecordView();
    }
  }

  function endRecording() {
    if (!recorder || recorder.state !== 'recording') return;
    clearInterval(tick);
    elapsed = Math.min(recordLimit, (Date.now() - startedAt) / 1000);
    try { recorder.stop(); } catch (error) { setError(error.message); disposeStream(); recorder = null; }
    $('record-btn').disabled = true;
    $('record-hint').textContent = 'Procesando tu grabación…';
    stopMicMeter();
  }

  function updateRecordView() {
    const active = !!recorder && recorder.state === 'recording';
    $('record-btn').classList.toggle('recording', active);
    $('record-glyph').textContent = active ? '■' : '🎙️';
    $('record-btn').setAttribute('aria-label', active ? 'Detener grabación' : 'Empezar a grabar');
    $('record-hint').textContent = active ? 'Pulsa para detener la grabación' : 'Toca para grabar · Máximo 12 segundos';
  }

  function controls(items, target = 'game-controls') {
    const area = $(target);
    area.replaceChildren();
    items.forEach(({ label, run, style = '', disabled = false, playing = false, group }) => {
      if (group) {
        const heading = document.createElement('div');
        heading.className = 'control-group-heading';
        heading.textContent = group;
        area.append(heading);
        return;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'control-btn ' + style + (playing ? ' is-playing' : '');
      button.textContent = label;
      button.disabled = disabled;
      button.setAttribute('aria-pressed', String(playing));
      button.addEventListener('click', run);
      area.append(button);
    });
  }

  function playbackOptions(buffer, prefix) {
    return [
      { label: currentPlayingKey === prefix + '-normal' ? '⏹ Detener original' : '▶️ Escuchar original',
        playing: currentPlayingKey === prefix + '-normal',
        run: () => play(buffer, prefix + '-normal') },
      { label: currentPlayingKey === prefix + '-reverse' ? '⏹ Detener reversa' : '⏪ Escuchar en reversa',
        style: 'main', playing: currentPlayingKey === prefix + '-reverse',
        run: () => play(buffer, prefix + '-reverse', true) }
    ];
  }

  function renderControls() {
    if (mode === 'flip') return renderFlipControls();
    if (recorder) { controls([]); return; }
    if (step === 'original') { controls([]); return; }
    if (step === 'listen') {
      controls([
        { group: '🎙️ TU PRIMERA GRABACIÓN' },
        ...playbackOptions(original, 'original'),
        { label: '🎤 ¡Voy a imitarlo!', style: 'secondary', run: () => { stopPlayback(); step = 'attempt'; render(); } },
        { label: '↻ Grabar otra frase', run: () => resetGame(false) }
      ]);
    } else if (step === 'attempt') {
      controls([
        { group: '🎧 ESCUCHA Y REPITE EL SONIDO' },
        ...playbackOptions(original, 'original'),
        { label: '← Volver atrás', run: () => { stopPlayback(); step = 'listen'; render(); } }
      ]);
    } else if (step === 'result') {
      controls([
        { group: '🎙️ PRIMERA GRABACIÓN' },
        ...playbackOptions(original, 'original'),
        { group: '😝 TU IMITACIÓN' },
        ...playbackOptions(attempt, 'attempt'),
        { group: '✨ COMPARTIR O VOLVER A JUGAR' },
        { label: '📤 Compartir resultado en reversa', style: 'secondary', run: () => shareAudio(attempt, 'rewind-mi-resultado.wav', true) },
        { label: '⬇️ Descargar resultado en reversa', run: () => downloadAudio(attempt, 'rewind-mi-resultado.wav', true) },
        { label: '🎙️ Repetir imitación', run: () => { stopPlayback(); attempt = null; step = 'attempt'; render(); } },
        { label: '⚡ Nuevo desafío', style: 'main', run: () => resetGame(true) }
      ]);
    }
  }

  function render() {
    $('round-pill').textContent = `Ronda ${String(round).padStart(2, '0')}`;
    const states = { original: 0, listen: 1, attempt: 2, result: 3 };
    const index = states[step];
    document.querySelectorAll('.step').forEach((el, i) => {
      el.classList.toggle('active', i === index);
      el.classList.toggle('done', i < index);
      const number = el.querySelector('span');
      number.textContent = i < index ? '✓' : String(i + 1);
      if (i === index) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
    });
    const header = {
      original: ['🎙️', 'Primero, graba tu voz', 'Pulsa el micrófono y di una frase de forma natural.'],
      listen: ['🎧', 'Escucha la original o en reversa', 'Tú eliges qué versión escuchar. Después, intenta imitar el sonido al revés.'],
      attempt: ['😝', '¡Te toca imitar el sonido!', 'Puedes repetir la original y la reversa antes de grabar tu imitación.'],
      result: ['🎉', '¡Ha llegado el gran momento!', 'Escucha y compara las dos grabaciones tanto originales como en reversa.']
    }[step];
    const status = $('status-area');
    status.querySelector('.status-icon').textContent = header[0];
    status.querySelector('h3').textContent = header[1];
    status.querySelector('p').textContent = header[2];
    $('prompt-box').hidden = step !== 'original';
    $('mic-area').hidden = !['original', 'attempt'].includes(step);
    updateRecordView();
    if (!recorder && !busy) $('record-btn').disabled = false;
    if (!recorder) {
      const b = currentBufferForWave();
      setWaveMeta(b ? `Audio listo · ${b.duration.toFixed(1)} s` : 'Preparado para grabar', b ? timeLabel(b.duration) : '00:00 / 00:12');
      drawWave(b);
    }
    renderControls();
    if (step === 'result') {
      if (!$('result-banner')) {
        const banner = document.createElement('div');
        banner.className = 'result-banner';
        banner.id = 'result-banner';
        banner.innerHTML = '<span class="sparkle">✨</span><span><strong>¡Reto completado!</strong> Puedes escuchar las dos grabaciones normal y en reversa, comparar y compartir el resultado.</span>';
        $('wave-box').insertAdjacentElement('afterend', banner);
      }
    } else { $('result-banner')?.remove(); }
  }

  function resetGame(nextRound) {
    stopPlayback();
    clearInterval(tick);
    disposeStream();
    original = null;
    attempt = null;
    if (nextRound) { round++; nextPhrase(); }
    step = 'original';
    setError('');
    render();
  }

  function nextPhrase() {
    let n = Math.floor(Math.random() * phrases.length);
    if (n === phraseIndex) n = (n + 1) % phrases.length;
    phraseIndex = n;
    $('phrase').textContent = phrases[n];
  }

  // Encode original or reversed AudioBuffer to a portable, uncompressed 16-bit WAV.
  function encodeWav(buffer) {
    const channels = Math.min(buffer.numberOfChannels, 2);
    const samples = buffer.length;
    const bytes = 44 + samples * channels * 2;
    const wav = new ArrayBuffer(bytes);
    const view = new DataView(wav);
    const ascii = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    ascii(0, 'RIFF'); view.setUint32(4, bytes - 8, true);
    ascii(8, 'WAVE'); ascii(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
    ascii(36, 'data'); view.setUint32(40, bytes - 44, true);
    let offset = 44;
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
        view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
        offset += 2;
      }
    }
    return new Blob([wav], { type: 'audio/wav' });
  }

  function makeAudioFile(buffer, name, reversed) {
    const blob = encodeWav(reversed ? reverseBuffer(buffer) : buffer);
    return new File([blob], name, { type: 'audio/wav' });
  }

  function saveFile(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function downloadAudio(buffer, name, reversed) {
    try { saveFile(makeAudioFile(buffer, name, reversed)); }
    catch (error) { setError('No pudimos descargar el audio: ' + error.message, mode === 'flip' ? 'upload-error' : 'error-bar'); }
  }

  async function shareAudio(buffer, name, reversed) {
    try {
      const file = makeAudioFile(buffer, name, reversed);
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Mi reto REWIND!', text: '😂 ¡Escucha mi desafío de voz al revés!' });
      } else {
        saveFile(file);
        setError('Tu navegador no permite compartir el archivo directamente. Lo hemos descargado para que puedas enviarlo por WhatsApp o donde quieras.');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') setError('No se pudo compartir: ' + error.message);
    }
  }

  function renderFlipControls() {
    if (!imported) { controls([], 'flip-actions'); return; }
    controls([
      { group: '🎧 ELIGE CÓMO QUIERES ESCUCHARLO' },
      ...playbackOptions(imported, 'file'),
      { label: '⬇️ Descargar audio invertido', style: 'secondary',
        run: () => downloadAudio(imported, 'rewind-audio-invertido.wav', true) }
    ], 'flip-actions');
  }

  function switchMode(toMode) {
    if (recorder || busy) { setError('Detén la grabación antes de cambiar de modo.'); return; }
    stopPlayback();
    mode = toMode;
    $('tab-challenge').classList.toggle('active', mode === 'challenge');
    $('tab-flip').classList.toggle('active', mode === 'flip');
    $('tab-challenge').setAttribute('aria-selected', mode === 'challenge');
    $('tab-flip').setAttribute('aria-selected', mode === 'flip');
    $('panel-challenge').hidden = mode !== 'challenge';
    $('panel-flip').hidden = mode !== 'flip';
    if (mode === 'challenge') { render(); requestAnimationFrame(resizeCanvas); }
    else renderFlipControls();
  }

  $('record-btn').addEventListener('click', () => {
    if (busy) return;
    if (recorder) endRecording();
    else if (step === 'original' || step === 'attempt') beginRecording(step);
  });
  $('new-phrase').addEventListener('click', nextPhrase);
  $('tab-challenge').addEventListener('click', () => switchMode('challenge'));
  $('tab-flip').addEventListener('click', () => switchMode('flip'));
  $('audio-upload').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    stopPlayback();
    imported = null;
    $('file-name').textContent = `Procesando: ${file.name}`;
    setError('', 'upload-error');
    renderFlipControls();
    if (file.size > 10 * 1024 * 1024) {
      $('file-name').textContent = 'Archivo demasiado grande.';
      setError('Selecciona un archivo de menos de 10 MB para evitar problemas de memoria.', 'upload-error');
      return;
    }
    try {
      imported = await getContext().decodeAudioData(await file.arrayBuffer());
      if (imported.duration > 60) {
        imported = null;
        throw new Error('El audio dura más de 60 segundos. Selecciona uno más corto.');
      }
      $('file-name').textContent = `✅ ${file.name} · ${imported.duration.toFixed(1)} segundos`;
      renderFlipControls();
    } catch (error) {
      $('file-name').textContent = 'No se pudo abrir el archivo.';
      setError(error?.message?.includes('60 segundos') ? error.message : 'Formato no compatible con tu navegador. Prueba con WAV, MP3 o M4A.', 'upload-error');
    }
  });
  $('year').textContent = new Date().getFullYear();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resizeCanvas).observe(canvas);
  else window.addEventListener('resize', resizeCanvas);
  render();
  requestAnimationFrame(resizeCanvas);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();