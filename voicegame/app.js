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
  let challengeKind = 'normal';
  let lastScores = null;
  const PLAYER_KEY = 'voicegame-local-profiles-v2';
  let profiles = [];
  let activeProfile = 'Invitado';
  let activeAvatar = '😎';


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
            const candidate = computeGameScore();
            if (!candidate?.valid) {
              attempt = null;
              throw new Error(candidate?.reason || 'No se pudo calcular la puntuación. Prueba otra imitación.');
            }
            lastScores = candidate;
            rememberScore(candidate.score);
            step = 'result';
            celebrate(candidate.score);
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
        { label: '🏆 Compartir mi puntuación y retar a un amigo', style: 'main', run: shareScore },
        { label: '📤 Compartir audio de mi imitación', style: 'secondary', run: () => shareAudio(attempt, 'rewind-mi-resultado.wav', challengeKind === 'reverse') },
        { label: '⬇️ Descargar mi imitación', run: () => downloadAudio(attempt, 'rewind-mi-resultado.wav', challengeKind === 'reverse') },
        { label: '🎙️ Repetir imitación', run: () => { stopPlayback(); attempt = null; step = 'attempt'; render(); } },
        { label: '⚡ Nuevo desafío', style: 'main', run: () => resetGame(true) }
      ]);
    }
  }


  // Optional user profiles and local leaderboard. No audio, accounts or scores go to a server.
  function storeProfiles() {
    try { localStorage.setItem(PLAYER_KEY, JSON.stringify({ profiles: profiles.slice(0, 30), activeProfile, activeAvatar })); }
    catch (_) { /* Browsers can disable storage; the game still works. */ }
  }
  function loadProfiles() {
    try {
      const raw = JSON.parse(localStorage.getItem(PLAYER_KEY) || '{}');
      profiles = Array.isArray(raw.profiles) ? raw.profiles.filter(p => p && typeof p.name === 'string' && p.name.length <= 18).slice(0, 30) : [];
      if (typeof raw.activeProfile === 'string') activeProfile = raw.activeProfile.slice(0, 18);
      if (typeof raw.activeAvatar === 'string' && [...raw.activeAvatar].length <= 3) activeAvatar = raw.activeAvatar;
    } catch (_) { profiles = []; }
    $('player-name').value = activeProfile === 'Invitado' ? '' : activeProfile;
    $('player-avatar').value = [...$('player-avatar').options].some(o => o.value === activeAvatar) ? activeAvatar : '😎';
    refreshRankings();
  }
  function savePlayer() {
    const name = $('player-name').value.trim().replace(/\s+/g, ' ').slice(0, 18) || 'Invitado';
    const avatar = $('player-avatar').value;
    activeProfile = name;
    activeAvatar = avatar;
    const existing = profiles.find(p => p.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'));
    if (existing) {
      activeProfile = existing.name;
      existing.avatar = avatar;
    } else if (name !== 'Invitado') {
      profiles.push({ name, avatar, best: 0, total: 0, games: 0 });
    }
    $('player-name').value = activeProfile === 'Invitado' ? '' : activeProfile;
    storeProfiles();
    refreshRankings();
  }
  function refreshRankings() {
    const list = $('local-ranking'); list.replaceChildren();
    const ranked = [...profiles].filter(p => p.games > 0).sort((a,b) => b.best-a.best || b.total/Math.max(1,b.games)-a.total/Math.max(1,a.games)).slice(0, 7);
    if (!ranked.length) { const li=document.createElement('li');li.textContent='¡Juega tu primera partida para entrar en el ranking!';list.append(li); }
    else ranked.forEach((p,i) => {
      const li = document.createElement('li');
      const left=document.createElement('span');left.textContent=(i===0?'🥇 ':i===1?'🥈 ':i===2?'🥉 ':i+1+'. ')+(p.avatar||'😎')+' '+p.name;
      const right=document.createElement('strong');right.textContent=String(p.best)+'/100';
      li.append(left,right);list.append(li);
    });
    const active=profiles.find(p=>p.name===activeProfile);
    $('player-stats').textContent=active && active.games
      ? '⭐ '+activeProfile+' · Mejor: '+active.best+'/100 · '+active.games+' partidas'
      : '🎮 '+activeProfile+' · Sin partidas todavía. Ranking solo de este dispositivo.';
  }
  function rememberScore(value) {
    let p=profiles.find(p=>p.name.toLocaleLowerCase('es')===activeProfile.toLocaleLowerCase('es'));
    if(!p){ p={name:activeProfile,avatar:activeAvatar,best:0,total:0,games:0};profiles.push(p); }
    p.avatar=activeAvatar;
    p.games=(Number(p.games)||0)+1;
    p.best=Math.max(Number(p.best)||0,value);
    p.total=(Number(p.total)||0)+value;
    profiles=profiles.slice(-30);
    storeProfiles();refreshRankings();
  }
  function setChallengeKind(kind) {
    if (busy || recorder || step === 'result') return;
    challengeKind=kind;
    updateKindUI();
    if(step !== 'original')render();
  }
  function updateKindUI() {
    $('kind-normal').classList.toggle('active',challengeKind==='normal');
    $('kind-reverse').classList.toggle('active',challengeKind==='reverse');
    $('kind-normal').setAttribute('aria-pressed',String(challengeKind==='normal'));
    $('kind-reverse').setAttribute('aria-pressed',String(challengeKind==='reverse'));
    $('kind-normal').disabled=!!recorder || busy || step==='result';
    $('kind-reverse').disabled=!!recorder || busy || step==='result';
    $('kind-explainer').textContent=challengeKind==='normal'
      ? '🎯 Imita la voz normal. El juego compara directamente la primera grabación con tu imitación, SIN invertirla.'
      : '⏪ Escucha la primera voz al revés e imita ese sonido. Para evaluar el reto, el juego invierte tu imitación y la compara con la primera voz.';
  }
  function computeGameScore() {
    if (!original || !attempt || !window.VoiceGameScoring) return null;
    const scoringTarget=challengeKind==='normal' ? attempt : reverseBuffer(attempt);
    return window.VoiceGameScoring.compare(original,scoringTarget);
  }
  function scoreReaction(value) {
    if(value>=90)return{icon:'🦄',title:'¡LEYENDA DE LA VOZ! 🏆',message:'¡Qué brutal! ¡Casi parece la misma grabación!'};
    if(value>=78)return{icon:'🦊',title:'¡LO HAS CLAVADO! 🎉',message:'¡El zorro está celebrando tu imitación!'};
    if(value>=62)return{icon:'🐼',title:'¡VAS MUY BIEN! ✨',message:'¡El panda te da un aplauso gigante!'};
    if(value>=43)return{icon:'🐵',title:'¡QUÉ PERSONAJE! 😂',message:'¡Buen intento! El mono se viene arriba.'};
    if(value>=23)return{icon:'🐸',title:'¡JAJA, CASI! 🤭',message:'¡La rana quiere una revancha!'};
    return{icon:'🦥',title:'¡HA SIDO UNA LOCURA! 🤣',message:'¡El perezoso está alucinando! ¡Prueba otra vez!'};
  }
  function celebrate(value) {
    const area=$('confetti-layer');area.replaceChildren();
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    const count=value>=80?45:value>=50?25:12;
    const colors=['#ff65aa','#ffd66e','#9d89ff','#62e1c7','#ffffff'];
    for(let i=0;i<count;i++){
      const bit=document.createElement('span');bit.className='confetti-bit';
      bit.style.setProperty('--left',Math.random()*100+'%');
      bit.style.setProperty('--delay',(Math.random()*.75)+'s');
      bit.style.setProperty('--duration',(1.9+Math.random()*1.4)+'s');
      bit.style.setProperty('--color',colors[i%colors.length]);
      area.append(bit);
    }
  }
  function scoreDisplay() {
    const board=$('score-board');
    board.hidden=step!=='result' || !lastScores?.valid;
    if(board.hidden)return;
    const v=lastScores.score, reaction=scoreReaction(v);
    $('score-character').textContent=reaction.icon;
    $('score-title').textContent=reaction.title;
    $('score-value').textContent=String(v);
    $('score-detail').textContent=reaction.message;
    const bars=$('score-bars');bars.replaceChildren();
    for(const [label,val] of [['🎵 Ritmo y pausas',lastScores.rhythm],['🔊 Parecido acústico',lastScores.sound],['⏱️ Duración',lastScores.duration]]){
      const row=document.createElement('div');row.className='score-metric';
      const heading=document.createElement('div');heading.className='score-metric-label';
      const title=document.createElement('span');title.textContent=label;
      const amount=document.createElement('span');amount.textContent=val+'%';heading.append(title,amount);
      const meter=document.createElement('div');meter.className='score-meter';
      const fill=document.createElement('span');fill.style.width=val+'%';meter.append(fill);row.append(heading,meter);bars.append(row);
    }
    $('score-alternative').textContent=challengeKind==='normal'
      ? '🎯 Modo voz real: la puntuación compara tus dos audios ORIGINALES, sin invertir ninguno.'
      : '⏪ Modo reversa: la puntuación compara tu imitación invertida con la primera grabación.';
  }
  async function shareScore() {
    if(!lastScores?.valid)return;
    const label=challengeKind==='normal'?'imitando la voz real':'imitando un audio en reversa';
    const message='🎙️ ¡He conseguido '+lastScores.score+'/100 en REWIND! '+scoreReaction(lastScores.score).icon+' ('+label+')\n¿Puedes superarme? 👇\nhttps://ayyoub1616.github.io/voicegame/';
    try {
      if(navigator.share)await navigator.share({title:'¡Supérame en REWIND!',text:message});
      else if(navigator.clipboard?.writeText) {await navigator.clipboard.writeText(message);setError('✅ ¡Reto copiado! Pégalo en WhatsApp o donde quieras.');}
      else setError('Comparte esta dirección con tus amigos: https://ayyoub1616.github.io/voicegame/');
    } catch(e) {if(e.name!=='AbortError')setError('No se pudo compartir el reto.');}
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
      listen: ['🎧', '¡Escucha y prepárate!', challengeKind === 'normal' ? 'Imita la voz ORIGINAL para conseguir puntos. También puedes escuchar el audio invertido.' : 'Escucha la versión INVERSA para intentar imitarla.'],
      attempt: ['😝', '¡Te toca imitar el sonido!', challengeKind === 'normal' ? 'Graba tu imitación de la voz REAL. Compararemos directamente los dos audios normales.' : 'Graba tu imitación del sonido INVERTIDO.'],
      result: ['🏆', '¡Ha llegado tu puntuación!', challengeKind === 'normal' ? 'Tu resultado compara las dos voces normales, sin invertirlas.' : 'Tu resultado compara la voz original con tu intento invertido.']
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
    updateKindUI();
    scoreDisplay();
    if (step === 'result') {
      if (!$('result-banner')) {
        const banner = document.createElement('div');
        banner.className = 'result-banner';
        banner.id = 'result-banner';
        banner.innerHTML = '<span class="sparkle">✨</span><span><strong>¡Reto completado!</strong> Mira tu puntuación, compara las dos grabaciones y reta a tus amigos.</span>';
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
    lastScores = null;
    $('confetti-layer').replaceChildren();
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
  $('kind-normal').addEventListener('click', () => setChallengeKind('normal'));
  $('kind-reverse').addEventListener('click', () => setChallengeKind('reverse'));
  $('save-player').addEventListener('click', savePlayer);
  $('player-name').addEventListener('keydown', e => { if(e.key === 'Enter') { e.preventDefault();savePlayer();$('player-name').blur(); } });
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
  loadProfiles();
  render();
  requestAnimationFrame(resizeCanvas);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();