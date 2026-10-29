/* REWIND! — privacy-first local voice capture, enhancement and shareable challenge clips. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const card = document.querySelector('.game-card');
  const canvas = $('waveform'), painter = canvas.getContext('2d');
  const prompts = [
    '¿Qué pasa, marcianos? 👽','La vaca cósmica baila salsa 🐮',
    '¡Soy una patata espacial! 🥔','Tres tigres hacen TikTok 🐯',
    'El unicornio tiene patinete 🦄','Mi gato habla marciano 🐱',
    '¡No soy yo, es mi voz! 🤪','¡Chocolate con churros! 🍫',
    '¿Por qué habla así mi móvil? 📱','Mi abuela baila reguetón 💃',
    '¡La pizza me está mirando! 🍕','¡Soy un robot averiado! 🤖',
    '¡No me hagas hablar al revés! 😂','¡Qué locura de universo! 🪐'
  ];
  const emojiPool = ['🤯','🤣','🦄','👽','🐵','😝','🎧','🐸','😂','🥳'];
  const reduceMotion = matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
  const maxDuration = 15;
  let state = 'idle', cleanOn = true, selfieOn = false, videoVariant = 'reverse';
  let raw = null, clean = null, audioContext = null, player = null, playing = '';
  let recorder = null, videoRecorder = null, stream = null, cameraStream = null, audioChunks = [], videoChunks = [];
  let recordedVideo = null, recordedVideoUrl = null, cameraFinished = Promise.resolve();
  let outputFile = null, outputVariant = '', exporting = false;
  let recordStart = 0, timer = null, analyzer = null, analyzerSource = null, meterData = null;
  let bars = Array(57).fill(.1), emoji = '🎤', promptIndex = 0, animationFrame = 0, lastTick = 0;

  // Remove traces of a previous version's locally stored user leaderboard.
  try { localStorage.removeItem('voicegame-local-profiles-v2'); } catch (_) {}

  const showError = (msg = '') => { $('errorMessage').textContent = msg; $('errorMessage').hidden = !msg; };
  const formatTime = n => {
    const sec = Math.floor(Math.max(0,n));
    return String(Math.floor(sec/60)).padStart(2,'0') + ':' + String(sec%60).padStart(2,'0');
  };
  function context() {
    if (!audioContext) {
      const AudioContextType = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextType) throw new Error('Este dispositivo no admite Web Audio.');
      audioContext = new AudioContextType();
    }
    return audioContext;
  }
  function activeAudio() { return cleanOn && clean ? clean : raw; }
  function pickType(options) { return options.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || ''; }
  function setLoading(text, on) {
    $('loading').hidden = !on;
    $('loadingMessage').textContent = text;
    card.classList.toggle('is-busy', on);
  }
  function setReaction(text) {
    const target = $('reaction');
    if (target.textContent === text) return;
    target.textContent = text;
    target.classList.remove('bounce');
    if (!reduceMotion) { void target.offsetHeight; target.classList.add('bounce'); }
  }
  function refresh() {
    const recording = state === 'recording', working = state === 'working', ready = state === 'ready';
    card.classList.toggle('recording', recording);
    const blocked = working || exporting;
    $('recordButton').disabled = blocked;
    $('recordButton').setAttribute('aria-pressed',String(recording));
    $('recordButton').setAttribute('aria-label',recording?'Detener grabación':ready?'Grabar otro audio':'Empezar grabación');
    $('recordSymbol').textContent = recording?'⏹️':ready?'🔄':'🎙️';
    $('recordText').textContent = recording?'DETENER':ready?'OTRA VEZ':'GRABAR';
    $('statusLabel').textContent = recording?'GRABANDO TU RETO':working?'PREPARANDO AUDIO':ready?'¡LISTO PARA REPRODUCIR!':'LISTO PARA GRABAR';
    $('clock').textContent = recording?'00:00 / 00:15':ready && activeAudio()?formatTime(activeAudio().duration):'00:00';
    $('playPanel').hidden = !ready;
    const optsDisabled = recording || working || exporting;
    $('cleanToggle').disabled = optsDisabled;
    $('selfieToggle').disabled = optsDisabled;
    $('newChallenge').disabled = optsDisabled;
    $('cleanToggle').classList.toggle('selected',cleanOn);
    $('cleanToggle').setAttribute('aria-pressed',String(cleanOn));
    $('cleanState').textContent = cleanOn?'ON':'OFF';
    $('selfieToggle').classList.toggle('selected',selfieOn);
    $('selfieToggle').setAttribute('aria-pressed',String(selfieOn));
    $('selfieState').textContent = selfieOn?'ON':'OFF';
    for(const [btn,kind,icon,label] of [['playOriginal','original','iconOriginal','labelOriginal'],['playReverse','reverse','iconReverse','labelReverse']]) {
      $(btn).disabled = !ready || exporting;
      $(btn).setAttribute('aria-pressed',String(playing===kind));
      $(icon).textContent = playing===kind?'⏹️':kind==='reverse'?'⏪':'▶️';
      $(label).textContent = playing===kind?'DETENER':kind==='reverse'?'REVERSA':'ORIGINAL';
    }
    $('clipReverse').classList.toggle('active',videoVariant==='reverse');
    $('clipReverse').setAttribute('aria-pressed',String(videoVariant==='reverse'));
    $('clipNormal').classList.toggle('active',videoVariant==='original');
    $('clipNormal').setAttribute('aria-pressed',String(videoVariant==='original'));
    ['clipReverse','clipNormal','shareTikTok','makeVideo','shareChallenge','saveAudio'].forEach(id=>$(id).disabled=!ready||exporting);
    setReaction(recording?'🔴':working?'✨':playing==='reverse'?'🤪':playing==='original'?'🎧':ready?emoji:'🎤');
    $('studioTitle').textContent = recording?'¡A por ese reto! 🎤':working?'Limpiando tu voz… ✨':playing==='reverse'?'¡Qué locura de sonido! 🤣':playing==='original'?'¡Esta es tu voz! 🎧':ready?'¡Tu audio está listo! 🥳':'¡Toca el micro y sorpréndete!';
    $('studioSubtitle').textContent = recording?'Habla con naturalidad, cerca del micro.':working?'Reducimos ruido y preparamos el resultado.':playing==='reverse'?'¿Quién diría que eres tú? 😂':playing==='original'?'Escucha cómo suena tu grabación.':ready?'Escucha original o reversa. ¡Y conviértelo en vídeo!':'Habla cerca del teléfono para una grabación más clara.';
    $('micHint').textContent=recording?'🔴 Grabando · Toca el botón para detener':working?'✨ Procesando audio…':ready?'🔁 Toca el botón grande para grabar otra vez':'👆 Un toque para empezar · Máximo 15 s';
    if(!recording && !working && activeAudio()) {
      $('clock').textContent=formatTime(activeAudio().duration);
    }
  }
  function stopAudio() {
    const old = player;player = null;playing='';
    if(old) { old.onended=null;try{old.stop()}catch(_){}try{old.disconnect()}catch(_){} }
  }
  function reverseBuffer(buffer) {
    const ctx=context(), out=ctx.createBuffer(buffer.numberOfChannels,buffer.length,buffer.sampleRate);
    for(let ch=0;ch<buffer.numberOfChannels;ch++) {
      const src=buffer.getChannelData(ch),dest=out.getChannelData(ch);
      for(let i=0;i<src.length;i++) dest[i]=src[src.length-i-1];
    }
    return out;
  }
  async function play(kind) {
    if(state!=='ready'||exporting||!activeAudio()) return;
    if(playing===kind){stopAudio();refresh();return}
    stopAudio();
    try {
      const ctx=context();await ctx.resume();
      const source=ctx.createBufferSource();
      source.buffer=kind==='reverse'?reverseBuffer(activeAudio()):activeAudio();
      source.connect(ctx.destination);
      player=source;playing=kind;
      source.onended=()=>{if(player!==source)return;player=null;playing='';refresh()};
      source.start();
      refresh();
    } catch(err){stopAudio();showError('No se puede reproducir: '+(err.message||err));refresh();}
  }

  // Audio cleaning: browser-level noise/echo suppression + gentle offline voice band-pass,
  // compression and an adaptive, slow-release noise gate. Not an AI voice isolator.
  async function enhance(buffer) {
    const AudioOffline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if(!AudioOffline) return buffer;
    const offline = new AudioOffline(buffer.numberOfChannels,buffer.length,buffer.sampleRate);
    const src=offline.createBufferSource();src.buffer=buffer;
    const hp=offline.createBiquadFilter();hp.type='highpass';hp.frequency.value=110;hp.Q.value=.7;
    const lp=offline.createBiquadFilter();lp.type='lowpass';lp.frequency.value=6800;lp.Q.value=.7;
    const presence=offline.createBiquadFilter();presence.type='peaking';presence.frequency.value=2450;presence.Q.value=.82;presence.gain.value=1.8;
    const compressor=offline.createDynamicsCompressor();compressor.threshold.value=-27;compressor.knee.value=18;compressor.ratio.value=2.5;compressor.attack.value=.008;compressor.release.value=.20;
    src.connect(hp);hp.connect(lp);lp.connect(presence);presence.connect(compressor);compressor.connect(offline.destination);
    src.start(0);
    const filtered=await offline.startRendering();
    const processed=context().createBuffer(filtered.numberOfChannels,filtered.length,filtered.sampleRate);
    const windowSize=Math.max(128,Math.floor(filtered.sampleRate*.024));
    const envelopes=[];
    const first=filtered.getChannelData(0);
    for(let i=0;i<first.length;i+=windowSize) {
      let sum=0;
      for(let j=i;j<Math.min(first.length,i+windowSize);j++){const v=first[j];sum+=v*v}
      envelopes.push(Math.sqrt(sum/Math.max(1,Math.min(windowSize,first.length-i))));
    }
    const sorted=[...envelopes].sort((a,b)=>a-b);
    const noiseFloor=sorted[Math.floor(sorted.length*.16)]||0;
    const threshold=Math.max(.007,Math.min(.032,noiseFloor*2.2));
    const release=.994,attack=.35;
    let currentGain=1,maximum=0;
    const outs=Array.from({length:filtered.numberOfChannels},(_,i)=>processed.getChannelData(i));
    const ins=Array.from({length:filtered.numberOfChannels},(_,i)=>filtered.getChannelData(i));
    for(let i=0;i<filtered.length;i++) {
      const rms=envelopes[Math.min(envelopes.length-1,Math.floor(i/windowSize))]||0;
      const desired=rms>=threshold ? 1 : .24 + .76*Math.pow(Math.min(1,rms/threshold),1.3);
      currentGain=desired>currentGain ? currentGain+(desired-currentGain)*attack : Math.max(desired,currentGain*release);
      for(let ch=0;ch<ins.length;ch++) {
        const x=ins[ch][i]*currentGain;outs[ch][i]=x;maximum=Math.max(maximum,Math.abs(x));
      }
    }
    const boost=maximum>.001 ? Math.min(1.6,.88/maximum) : 1;
    if(boost!==1) for(const data of outs)for(let i=0;i<data.length;i++)data[i]=Math.max(-1,Math.min(1,data[i]*boost));
    return processed;
  }
  async function applyEnhancement() {
    if(!raw) return;
    state='working';refresh();
    try { clean=cleanOn?await enhance(raw):null; }
    catch(_) {clean=null;showError('El filtro avanzado no está disponible aquí. Puedes seguir escuchando tu audio.');}
    state='ready';buildBars();refresh();
  }
  function stopMic() {
    if(analyzerSource){try{analyzerSource.disconnect()}catch(_){}analyzerSource=null}
    if(analyzer){try{analyzer.disconnect()}catch(_){}analyzer=null}
    if(stream){stream.getTracks().forEach(track=>track.stop());stream=null}
    cameraStream=null;meterData=null;
  }
  function clearCameraVideo() {
    if(recordedVideoUrl){URL.revokeObjectURL(recordedVideoUrl);recordedVideoUrl=null}
    recordedVideo=null;
    const video=$('selfiePreview');video.pause();video.srcObject=null;video.removeAttribute('src');video.load();
    $('selfieBox').hidden=true;
  }
  function clearExport() {outputFile=null;outputVariant='';$('shareResult').hidden=true;}
  function videoMime() {return pickType(['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp8','video/webm']);}
  function audioMime() {return pickType(['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus']);}

  async function startRecording() {
    if(state==='working'||exporting||state==='recording')return;
    showError();stopAudio();clearExport();clearCameraVideo();
    raw=null;clean=null;bars.fill(.1);refresh();
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder) {
      showError('Abre la web en Safari o Chrome con HTTPS y permite el micrófono.');return;
    }
    state='working';refresh();
    try {
      let videoEnabled=selfieOn;
      try{
        stream=await navigator.mediaDevices.getUserMedia({
          audio:{noiseSuppression:{ideal:true},echoCancellation:{ideal:true},autoGainControl:{ideal:false},channelCount:{ideal:1}},
          video:videoEnabled?{facingMode:'user',width:{ideal:720},height:{ideal:1280}}:false
        });
      }catch(err){
        if(!videoEnabled)throw err;
        stream=await navigator.mediaDevices.getUserMedia({audio:{noiseSuppression:{ideal:true},echoCancellation:{ideal:true},autoGainControl:{ideal:false}},video:false});
        videoEnabled=false;selfieOn=false;showError('📷 La cámara no está disponible. Grabaremos solo tu voz.');
      }
      const micOnly=new MediaStream(stream.getAudioTracks());
      const mime=audioMime();
      recorder=new MediaRecorder(micOnly,mime?{mimeType:mime}:undefined);
      audioChunks=[];
      recorder.ondataavailable=e=>{if(e.data?.size)audioChunks.push(e.data)};
      recorder.onerror=()=>showError('Ha habido un error al grabar. Inténtalo otra vez.');
      recorder.onstop=async()=>{
        clearInterval(timer);timer=null;
        if(videoRecorder?.state==='recording')try{videoRecorder.stop()}catch(_){}
        stopMic();
        state='working';refresh();
        try{
          if(!audioChunks.length)throw new Error('No se ha podido grabar el sonido.');
          const b=new Blob(audioChunks,{type:recorder?.mimeType||mime||audioChunks[0].type});
          raw=await context().decodeAudioData(await b.arrayBuffer());
          if(raw.duration<.25)throw new Error('Habla al menos un segundo para que se escuche.');
          clean=cleanOn?await enhance(raw):null;
          emoji=emojiPool[Math.floor(Math.random()*emojiPool.length)];
          await cameraFinished.catch(()=>{});
          if(recordedVideo){
            recordedVideoUrl=URL.createObjectURL(recordedVideo);
            const selfie=$('selfiePreview');selfie.srcObject=null;selfie.src=recordedVideoUrl;selfie.muted=true;selfie.loop=true;selfie.play().catch(()=>{});
            $('selfieBox').hidden=false;
          }else{$('selfieBox').hidden=true}
          state='ready';buildBars();
        }catch(err){
          raw=null;clean=null;state='idle';showError('No hemos podido procesar el audio: '+err.message);
        }finally{audioChunks=[];recorder=null;refresh()}
      };
      if(videoEnabled && stream.getVideoTracks().length){
        const selfie=$('selfiePreview');
        selfie.srcObject=stream;selfie.muted=true;selfie.play().catch(()=>{});
        $('selfieBox').hidden=false;
        videoChunks=[];
        let endCamera;
        cameraFinished=new Promise(resolve=>{endCamera=resolve});
        try{
          const cameraOnly=new MediaStream(stream.getVideoTracks()),type=videoMime();
          videoRecorder=new MediaRecorder(cameraOnly,type?{mimeType:type}:undefined);
          videoRecorder.ondataavailable=e=>{if(e.data?.size)videoChunks.push(e.data)};
          videoRecorder.onstop=()=>{
            if(videoChunks.length)recordedVideo=new Blob(videoChunks,{type:videoRecorder.mimeType||type||videoChunks[0].type});
            videoRecorder=null;endCamera();
          };
          videoRecorder.onerror=()=>endCamera();
          videoRecorder.start(250);
        }catch(err){
          videoRecorder=null;recordedVideo=null;endCamera();
          showError('📷 Tu navegador no permite grabar el selfie como vídeo. Tu voz sí se grabará.');
        }
      }else cameraFinished=Promise.resolve();
      try{
        const ctx=context();
        analyzerSource=ctx.createMediaStreamSource(micOnly);
        analyzer=ctx.createAnalyser();analyzer.fftSize=1024;
        analyzerSource.connect(analyzer);meterData=new Uint8Array(analyzer.fftSize);
      }catch(_){}
      recorder.start(250);
      state='recording';recordStart=performance.now();refresh();
      timer=setInterval(()=>{
        if(state!=='recording')return;
        const sec=(performance.now()-recordStart)/1000;
        $('clock').textContent=formatTime(sec)+' / 00:15';
        if(sec>=maxDuration)stopRecording();
      },120);
    }catch(err){
      stopMic();state='idle';recorder=null;clearCameraVideo();refresh();
      if(err.name==='NotAllowedError'||err.name==='PermissionDeniedError')showError('🎤 Permite el acceso al micrófono (y a la cámara si la activaste) en Safari/Chrome.');
      else if(err.name==='NotFoundError')showError('No hay un micrófono disponible.');
      else showError('No se puede empezar a grabar: '+(err.message||err));
    }
  }
  function stopRecording() {
    if(state!=='recording'||!recorder)return;
    clearInterval(timer);timer=null;
    try{recorder.stop();state='working';refresh()}
    catch(err){showError('No se ha podido detener el micrófono.');stopMic();state='idle';refresh()}
  }

  function resize() {
    const b=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.max(170,Math.round(b.width*dpr));canvas.height=Math.max(70,Math.round(b.height*dpr));
  }
  function buildBars() {
    const b=activeAudio();if(!b)return;
    const a=b.getChannelData(0),n=bars.length;
    const maxAmp=[];
    for(let i=0;i<n;i++){
      let peak=0;
      const left=Math.floor(i*a.length/n),right=Math.floor((i+1)*a.length/n);
      for(let j=left;j<right;j+=Math.max(1,Math.floor((right-left)/80)))peak=Math.max(peak,Math.abs(a[j]));
      maxAmp.push(peak);
    }
    const top=Math.max(.02,...maxAmp);
    bars=maxAmp.map(v=>Math.max(.09,Math.min(1,v/top)));
  }
  function paintWave(ts) {
    if(ts-lastTick>42&&!document.hidden&&painter){
      lastTick=ts;
      const w=canvas.width,h=canvas.height,spacing=w/bars.length;
      painter.clearRect(0,0,w,h);
      const grad=painter.createLinearGradient(0,0,w,0);
      grad.addColorStop(0,'#ff72b1');grad.addColorStop(.49,'#9a8bff');grad.addColorStop(1,'#5af3cd');
      painter.fillStyle=grad;
      let micLevel=0;
      if(analyzer&&meterData&&state==='recording') {
        analyzer.getByteTimeDomainData(meterData);
        for(const val of meterData)micLevel+=((val-128)/128)**2;
        micLevel=Math.min(1,Math.sqrt(micLevel/meterData.length)*5);
      }
      for(let i=0;i<bars.length;i++){
        const idle=.13+.13*Math.abs(Math.sin(i*.39+ts/2200))+.12*Math.abs(Math.sin(i*.17));
        const active=state==='recording'?Math.max(.1,micLevel*(.45+.55*Math.abs(Math.sin(i*.54+ts/250)))):
          state==='ready'&&activeAudio()?bars[i]*(playing?.86+.12*Math.sin(i*.3+ts/250):1):idle;
        const height=Math.max(4,Math.min(1,active)*h*.83),width=Math.max(3,spacing*.52);
        if(painter.roundRect){painter.beginPath();painter.roundRect(i*spacing+(spacing-width)/2,(h-height)/2,width,height,width/2);painter.fill();}
        else painter.fillRect(i*spacing+(spacing-width)/2,(h-height)/2,width,height);
      }
    }
    animationFrame=requestAnimationFrame(paintWave);
  }

  function caption(){return '#REWINDChallenge 🎙️⏪😂 ¿Te atreves a grabar tu voz al revés? ¡Reta a tus amigos! https://ayyoub1616.github.io/voicegame/';}
  function shareTitle(){return 'REWIND! — Mi voz '+(videoVariant==='reverse'?'al revés':'original');}
  function createWav(buffer, name) {
    const channels=Math.min(buffer.numberOfChannels,2);
    const bytes=44+buffer.length*channels*2;
    const rawBytes=new ArrayBuffer(bytes),view=new DataView(rawBytes);
    const ascii=(position,str)=>{for(let i=0;i<str.length;i++)view.setUint8(position+i,str.charCodeAt(i))};
    ascii(0,'RIFF');view.setUint32(4,bytes-8,true);
    ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);
    view.setUint16(20,1,true);view.setUint16(22,channels,true);
    view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*2,true);
    view.setUint16(32,channels*2,true);view.setUint16(34,16,true);
    ascii(36,'data');view.setUint32(40,bytes-44,true);
    let offset=44;
    for(let i=0;i<buffer.length;i++)for(let ch=0;ch<channels;ch++){
      const v=Math.max(-1,Math.min(1,buffer.getChannelData(ch)[i]));
      view.setInt16(offset,v<0?v*32768:v*32767,true);
      offset+=2;
    }
    return new File([rawBytes],name,{type:'audio/wav'});
  }
  function downloadAudio() {
    if(state!=='ready'||exporting)return;
    try {
      const buffer=videoVariant==='reverse'?reverseBuffer(activeAudio()):activeAudio();
      savedVideoLink(createWav(buffer,'rewind-'+videoVariant+'.wav'));
      setShareInfo('✅ Audio WAV guardado. Puedes enviarlo por WhatsApp o usarlo en un editor de vídeo.');
    } catch(err) { showError('No se puede guardar el audio: '+(err.message||err)); }
  }
  function savedVideoLink(file) {
    const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
  }
  function setShareInfo(text){$('shareResultText').textContent=text;$('shareResult').hidden=false;}
  function setVariant(kind){
    if(exporting)return;
    videoVariant=kind;clearExport();refresh();
  }

  function drawVideoFrame(c,ctx,p,variant,video) {
    const W=c.width,H=c.height;
    const gradient=ctx.createLinearGradient(0,0,W,H);
    gradient.addColorStop(0,'#201444');gradient.addColorStop(.5,'#512266');gradient.addColorStop(1,'#143b5a');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,W,H);
    if(video && video.readyState>=2) {
      const sw=video.videoWidth,sh=video.videoHeight;
      if(sw>0&&sh>0) {
        const rw=W/sw,rh=H/sh,scale=Math.max(rw,rh),dw=sw*scale,dh=sh*scale;
        ctx.save();ctx.globalAlpha=.5;ctx.drawImage(video,(W-dw)/2,(H-dh)/2,dw,dh);
        ctx.fillStyle='rgba(12,14,31,.42)';ctx.fillRect(0,0,W,H);ctx.restore();
        const diameter=320,x=(W-diameter)/2,y=220;
        ctx.save();ctx.beginPath();ctx.roundRect(x,y,diameter,diameter,42);ctx.clip();
        const scale2=Math.max(diameter/sw,diameter/sh),wd=sw*scale2,hd=sh*scale2;
        ctx.drawImage(video,x+(diameter-wd)/2,y+(diameter-hd)/2,wd,hd);
        ctx.restore();
        ctx.strokeStyle='rgba(255,255,255,.7)';ctx.lineWidth=5;ctx.strokeRect(x+2,y+2,diameter-4,diameter-4);
      }
    } else {
      const emojis=['🌀','😂','🤯','🎙️','🔥','✨'];
      ctx.font='80px system-ui';ctx.textAlign='center';
      ctx.fillText(emojis[Math.floor(p*emojis.length)%emojis.length],270,370);
    }
    ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='900 58px system-ui';
    ctx.fillText('REWIND!',270,135);
    ctx.font='700 26px system-ui';ctx.fillStyle='#f8b7eb';ctx.fillText('EL RETO DE TU VOZ',270,185);
    ctx.fillStyle='#fff';ctx.font='900 43px system-ui';ctx.fillText(variant==='reverse'?'⏪ ¿CÓMO SUENAS':'🎤 ESTA ES',270,650);
    ctx.fillText(variant==='reverse'?'AL REVÉS? 😂':'MI VOZ REAL',270,704);
    const count=29,width=W/count;
    for(let i=0;i<count;i++){
      const power=.17+.67*Math.abs(Math.sin(i*.39+p*39))*(.45+.55*Math.abs(Math.cos(i*.13+p*11)));
      const len=15+power*105;
      ctx.fillStyle=i%3===0?'#fda7db':i%3===1?'#a5a1ff':'#6ff7d5';
      ctx.beginPath();ctx.roundRect(i*width+6,777-len/2,width*.54,len,5);ctx.fill();
    }
    ctx.fillStyle='rgba(255,255,255,.88)';ctx.font='700 23px system-ui';ctx.fillText('🎯 #REWINDChallenge',270,875);
    ctx.fillStyle='rgba(255,255,255,.65)';ctx.font='18px system-ui';ctx.fillText('ayyoub1616.github.io/voicegame',270,919);
  }

  async function renderVideo() {
    if(!activeAudio())throw new Error('Primero graba un audio.');
    const surface=document.createElement('canvas');surface.width=540;surface.height=960;
    if(typeof surface.captureStream!=='function')throw new Error('Este navegador no permite crear vídeos desde la web. Prueba otro navegador o graba la pantalla.');
    const type=videoMime();
    if(!type)throw new Error('Tu navegador no admite exportar vídeos. Puedes compartir el enlace del reto.');
    const ctx2=surface.getContext('2d',{alpha:false});
    const audio=context();await audio.resume();
    const buffer=videoVariant==='reverse'?reverseBuffer(activeAudio()):activeAudio();
    const destination=audio.createMediaStreamDestination();
    const sound=audio.createBufferSource();sound.buffer=buffer;sound.connect(destination);
    let video=null;
    if(recordedVideoUrl){
      video=document.createElement('video');video.src=recordedVideoUrl;video.muted=true;video.playsInline=true;
      await new Promise(resolve=>{if(video.readyState>=2)return resolve();video.onloadeddata=resolve;video.onerror=resolve;setTimeout(resolve,1800)});
      if(video.readyState>=2){try{video.currentTime=0;await video.play()}catch(_){}}
    }
    drawVideoFrame(surface,ctx2,0,videoVariant,video);
    const frames=surface.captureStream(25);
    const mixed=new MediaStream([...frames.getVideoTracks(),...destination.stream.getAudioTracks()]);
    let session=null,finished=false,raf=0,stopper=0,packets=[];
    try{
      session=new MediaRecorder(mixed,{mimeType:type,videoBitsPerSecond:2000000,audioBitsPerSecond:128000});
      const clip=new Promise((resolve,reject)=>{
        session.ondataavailable=e=>{if(e.data?.size)packets.push(e.data)};
        session.onerror=()=>reject(new Error('La grabación del vídeo ha fallado.'));
        session.onstop=()=>packets.length?resolve(new Blob(packets,{type:session.mimeType||type})):reject(new Error('El vídeo se ha generado vacío.'));
      });
      const duration=buffer.duration,startedAt=performance.now();
      const animate=()=>{
        const elapsed=(performance.now()-startedAt)/1000;
        drawVideoFrame(surface,ctx2,Math.min(1,elapsed/Math.max(.1,duration)),videoVariant,video);
        if(!finished)raf=requestAnimationFrame(animate);
      };
      session.start(200);
      sound.start(audio.currentTime+.08);
      animate();
      stopper=setTimeout(()=>{finished=true;if(session.state!=='inactive')session.stop()},Math.ceil((duration+.42)*1000));
      const blob=await clip;
      const ext=blob.type.includes('mp4')?'mp4':'webm';
      return new File([blob],'rewind-reto-'+videoVariant+'.'+ext,{type:blob.type});
    }finally{
      finished=true;cancelAnimationFrame(raf);clearTimeout(stopper);
      if(session?.state==='recording')try{session.stop()}catch(_){}
      try{sound.stop()}catch(_){}try{sound.disconnect()}catch(_){}
      frames.getTracks().forEach(t=>t.stop());
      destination.stream.getTracks().forEach(t=>t.stop());
      video?.pause();
    }
  }
  async function getVideo() {
    if(outputFile&&outputVariant===videoVariant)return outputFile;
    exporting=true;stopAudio();refresh();
    setLoading('🎬 Montando tu vídeo vertical…',true);
    try{
      const result=await renderVideo();
      outputFile=result;outputVariant=videoVariant;
      return result;
    } finally{exporting=false;setLoading('',false);refresh()}
  }
  async function createVideoAndSave(){
    if(state!=='ready'||exporting)return;
    showError();
    try{const file=await getVideo();savedVideoLink(file);setShareInfo('✅ Vídeo guardado. Abre TikTok y selecciónalo desde tu galería o archivos.');}
    catch(err){showError('No hemos podido crear el vídeo: '+(err.message||err));}
  }
  async function shareTikTok(){
    if(state!=='ready'||exporting)return;
    showError();
    try{
      const alreadyReady=!!outputFile&&outputVariant===videoVariant;
      if(!alreadyReady) {
        await getVideo();
        setShareInfo('✅ ¡Vídeo listo! Pulsa de nuevo «Compartir en TikTok» para abrir las aplicaciones compatibles, o «Crear / guardar vídeo» para subirlo manualmente.');
        return;
      }
      const file=outputFile;
      if(navigator.share && navigator.canShare?.({files:[file]})) {
        try{await navigator.share({files:[file],title:shareTitle(),text:'#REWINDChallenge #VozAlReves'});setShareInfo('📲 Elige TikTok si aparece en el menú. También puedes guardarlo y subirlo desde TikTok.');}
        catch(err){if(err.name!=='AbortError'){savedVideoLink(file);setShareInfo('📥 He preparado la descarga del vídeo. Abre TikTok y súbelo desde tus archivos.');}}
      } else {savedVideoLink(file);setShareInfo('📥 Tu navegador no permite enviar directamente este formato. Descarga el vídeo y súbelo desde TikTok.');}
    }catch(err){showError('No hemos podido preparar el vídeo: '+(err.message||err));}
  }
  async function shareChallenge(){
    showError();
    const text=caption();
    try {
      if(navigator.share)await navigator.share({title:'¡Te reto a jugar REWIND!',text,url:'https://ayyoub1616.github.io/voicegame/'});
      else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);setShareInfo('✅ Reto copiado. Pégalo en WhatsApp o en tu red social favorita.');}
      else setShareInfo('📲 Comparte este enlace: https://ayyoub1616.github.io/voicegame/');
    }catch(err){if(err.name!=='AbortError')setShareInfo('📲 Comparte el enlace https://ayyoub1616.github.io/voicegame/');}
  }

  function choosePrompt(){
    let next=Math.floor(Math.random()*prompts.length);
    if(next===promptIndex)next=(next+1)%prompts.length;
    promptIndex=next;$('challengePhrase').textContent=prompts[next];
    const el=$('challengeBox');el.classList.remove('bump');if(!reduceMotion){void el.offsetWidth;el.classList.add('bump');}
  }
  $('recordButton').addEventListener('click',()=>state==='recording'?stopRecording():startRecording());
  $('playOriginal').addEventListener('click',()=>play('original'));
  $('playReverse').addEventListener('click',()=>play('reverse'));
  $('cleanToggle').addEventListener('click',async()=>{
    if(state==='recording'||state==='working'||exporting)return;
    cleanOn=!cleanOn;clearExport();stopAudio();
    if(state==='ready'&&raw)await applyEnhancement();else refresh();
  });
  $('selfieToggle').addEventListener('click',()=>{
    if(state==='recording'||state==='working'||exporting)return;
    selfieOn=!selfieOn;refresh();
    if(state==='ready')setShareInfo('📸 El selfie se graba al iniciar una nueva grabación. Toca «OTRA VEZ» para activarlo.');
  });
  $('newChallenge').addEventListener('click',choosePrompt);
  $('clipReverse').addEventListener('click',()=>setVariant('reverse'));
  $('clipNormal').addEventListener('click',()=>setVariant('original'));
  $('makeVideo').addEventListener('click',createVideoAndSave);
  $('saveAudio').addEventListener('click',downloadAudio);
  $('shareTikTok').addEventListener('click',shareTikTok);
  $('shareChallenge').addEventListener('click',shareChallenge);
  window.addEventListener('resize',resize);
  window.addEventListener('pagehide',()=>{
    clearInterval(timer);stopAudio();
    if(recorder?.state==='recording')try{recorder.stop()}catch(_){}
    if(videoRecorder?.state==='recording')try{videoRecorder.stop()}catch(_){}
    stopMic();clearCameraVideo();
  });
  if('ResizeObserver' in window)new ResizeObserver(resize).observe(canvas);
  resize();refresh();animationFrame=requestAnimationFrame(paintWave);
  if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')){
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  }
})();