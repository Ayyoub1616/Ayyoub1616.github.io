/* REWIND! — two-player reverse-speech challenge. No accounts or server uploads. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const buttons = { red: $('recordButton'), green: $('originalButton'), blue: $('reverseButton') };
  const icons = {
    mic:'<rect x="38" y="15" width="24" height="46" rx="12" fill="currentColor"/><path d="M26 49a24 24 0 0 0 48 0M50 73v15M37 88h26" stroke="currentColor" fill="none" stroke-width="7" stroke-linecap="round"/>',
    stop:'<rect x="29" y="29" width="42" height="42" rx="8" fill="currentColor"/>',
    play:'<path d="M33 20 Q33 16 39 19 L79 45 Q85 50 79 55 L39 81 Q33 85 33 78Z" fill="currentColor"/>',
    reverse:'<path d="M67 20 Q67 16 61 19 L21 45 Q15 50 21 55 L61 81 Q67 85 67 78Z" fill="currentColor"/>',
    next:'<path d="M28 20 65 50 28 80M63 50H24" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>',
    refresh:'<path d="M77 42A29 29 0 1 0 79 57M78 22v23H55" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>'
  };
  const LIMIT=15;
  let stage='host', recording=false, processing=false, context=null, micStream=null, media=null;
  let captureSource=null, processor=null, silentGain=null, pcmChunks=[],encodedChunks=[],captureRate=44100,clockId=null,begin=0;
  let host=null, rival=null, audio=document.createElement('audio'), playing='', currentPlayback='', filterEnabled=true, pending=false;
  audio.preload='auto';audio.playsInline=true;audio.setAttribute('playsinline','');audio.style.display='none';
  document.body.appendChild(audio);
  const nativeCodes=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'];
  try { localStorage.removeItem('voicegame-local-profiles-v2'); } catch (_) {}

  function notify(message='',isError=false) {
    const line=$('feedback');line.textContent=message;line.classList.toggle('error',isError);
  }
  function audioContext(){
    if(!context){
      const Type=window.AudioContext||window.webkitAudioContext;
      if(!Type)throw new Error('El navegador no permite grabar audio.');
      context=new Type();
    }
    return context;
  }
  function clearTimer(){if(clockId){clearInterval(clockId);clockId=null;}}
  function timerLabel(s){s=Math.floor(Math.max(0,s));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')}
  function stopPlaying(){
    audio.pause();audio.onended=null;audio.onerror=null;audio.removeAttribute('src');
    try{audio.load();}catch(_){}
    playing='';currentPlayback='';
  }
  function disposeCapture(){
    if(processor){processor.onaudioprocess=null;try{processor.disconnect()}catch(_){}processor=null;}
    if(captureSource){try{captureSource.disconnect()}catch(_){}captureSource=null;}
    if(silentGain){try{silentGain.disconnect()}catch(_){}silentGain=null;}
    if(micStream){micStream.getTracks().forEach(t=>t.stop());micStream=null;}
  }
  function wav(data,sampleRate,reverse=false){
    // Linear PCM WAV plays natively in Safari, Chrome and most other mobile browsers.
    const length=data.length,block=new ArrayBuffer(44+length*2),view=new DataView(block);
    function textAt(pos,str){for(let i=0;i<str.length;i++)view.setUint8(pos+i,str.charCodeAt(i))}
    textAt(0,'RIFF');view.setUint32(4,36+length*2,true);
    textAt(8,'WAVE');textAt(12,'fmt ');view.setUint32(16,16,true);
    view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
    view.setUint16(32,2,true);view.setUint16(34,16,true);
    textAt(36,'data');view.setUint32(40,length*2,true);
    for(let i=0;i<length;i++){
      const v=Math.max(-1,Math.min(1,data[reverse?length-1-i:i]));
      view.setInt16(44+2*i,v<0?v*32768:v*32767,true);
    }
    return new Blob([block],{type:'audio/wav'});
  }
  function processVoice(pcm,rate){
    if(!filterEnabled)return pcm;
    // Gentle high/low-pass and reduction of very quiet background noise.
    const out=new Float32Array(pcm.length);
    const high=Math.exp(-2*Math.PI*95/rate);
    const low=Math.exp(-2*Math.PI*6500/rate);
    let oldIn=0,highLast=0,lowLast=0,max=0;
    for(let i=0;i<pcm.length;i++){
      const h=high*(highLast+pcm[i]-oldIn);
      oldIn=pcm[i];highLast=h;
      lowLast=(1-low)*h+low*lowLast;
      let v=lowLast;
      // Soft attenuation, not complete muting, to preserve syllable beginnings.
      const level=Math.abs(v);
      if(level<.012)v*=.58+.42*(level/.012);
      out[i]=v;max=Math.max(max,Math.abs(v));
    }
    const gain=max>.002?Math.min(1.5,.88/max):1;
    if(gain!==1)for(let i=0;i<out.length;i++)out[i]=Math.max(-1,Math.min(1,out[i]*gain));
    return out;
  }
  function createRecording(pcm,rate){
    if(!pcm?.length)throw new Error('La grabación está vacía.');
    if(pcm.length/rate<.22)throw new Error('Habla un poco más de tiempo.');
    const refined=processVoice(pcm,rate);
    const raw=URL.createObjectURL(wav(refined,rate));
    const backwards=URL.createObjectURL(wav(refined,rate,true));
    return {normalUrl:raw,reverseUrl:backwards,duration:pcm.length/rate};
  }
  function freeRecording(rec){
    if(!rec)return;
    if(rec.normalUrl)URL.revokeObjectURL(rec.normalUrl);
    if(rec.reverseUrl)URL.revokeObjectURL(rec.reverseUrl);
  }
  function flattenChunks(){
    if(!pcmChunks.length)return null;
    const total=pcmChunks.reduce((n,a)=>n+a.length,0);
    if(total<100)return null;
    const pcm=new Float32Array(total);
    let at=0;for(const segment of pcmChunks){pcm.set(segment,at);at+=segment.length;}
    // Suspended AudioContext can yield silence. In that case try MediaRecorder.
    const sample=Math.max(1,Math.floor(total/3000));let peak=0;
    for(let i=0;i<total;i+=sample)peak=Math.max(peak,Math.abs(pcm[i]));
    return peak>.0005?pcm:null;
  }
  function configurePCM(stream){
    const ctx=audioContext();
    if(typeof ctx.createScriptProcessor!=='function')return false;
    try {
      captureSource=ctx.createMediaStreamSource(stream);
      processor=ctx.createScriptProcessor(2048,1,1);
      silentGain=ctx.createGain();silentGain.gain.value=0;
      processor.onaudioprocess=e=>{
        if(!recording)return;
        const input=e.inputBuffer.getChannelData(0);
        pcmChunks.push(new Float32Array(input));
        // Ensure silence at output to prevent microphone feedback.
        const output=e.outputBuffer.getChannelData(0);output.fill(0);
      };
      captureSource.connect(processor);processor.connect(silentGain);silentGain.connect(ctx.destination);
      captureRate=ctx.sampleRate;
      return true;
    }catch(err){
      // Fallback to MediaRecorder must keep the active microphone stream.
      if(processor){processor.onaudioprocess=null;try{processor.disconnect()}catch(_){}processor=null;}
      if(captureSource){try{captureSource.disconnect()}catch(_){}captureSource=null;}
      if(silentGain){try{silentGain.disconnect()}catch(_){}silentGain=null;}
      return false;
    }
  }
  function pickMime(){return nativeCodes.find(m=>window.MediaRecorder?.isTypeSupported?.(m))||'';}
  async function beginRecording(){
    if(recording||processing||pending)return;
    if(!navigator.mediaDevices?.getUserMedia){notify('Activa HTTPS y permite el micrófono en Safari o Chrome.',true);return;}
    if(stage!=='host'&&stage!=='rival')return;
    stopPlaying();pending=true;render();notify('🎤 Permite el micrófono para empezar.');
    try {
      // Unlock WebAudio inside a real tap on iPhone. Actual playback uses native HTML audio.
      const ctx=audioContext();
      ctx.resume().catch(()=>{});
      micStream=await navigator.mediaDevices.getUserMedia({
        audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1},
        video:false
      });
      pcmChunks=[];encodedChunks=[];
      let pcmAvailable=configurePCM(micStream);
      if(window.MediaRecorder){
        try {
          const mime=pickMime();
          media=new MediaRecorder(micStream,mime?{mimeType:mime}:undefined);
          media.ondataavailable=e=>{if(e.data?.size)encodedChunks.push(e.data)};
          media.onstop=()=>finishRecording();
          media.onerror=()=>notify('⚠️ Error durante la grabación. Prueba otra vez.',true);
        } catch (err) {
          media=null;
          if(!pcmAvailable)throw err;
        }
      }else if(!pcmAvailable)throw new Error('Este navegador no admite grabaciones.');
      recording=true;pending=false;
      if(media)media.start(200);
      begin=performance.now();render();
      notify('🔴 Grabando… pulsa el botón rojo para detener.');
      clockId=setInterval(()=>{
        if(!recording)return;
        $('recordDetail').textContent='🔴 '+timerLabel((performance.now()-begin)/1000)+' / 00:15';
        if((performance.now()-begin)/1000>=LIMIT)endRecording();
      },110);
    }catch(err){
      pending=false;recording=false;processing=false;media=null;
      disposeCapture();render();
      const text=err.name==='NotAllowedError'?'Permite usar el micrófono en los ajustes del navegador.':
        err.name==='NotFoundError'?'No se ha detectado ningún micrófono.':err.message||'No se pudo grabar.';
      notify('⚠️ '+text,true);
    }
  }
  function endRecording(){
    if(!recording)return;
    recording=false;processing=true;clearTimer();render();
    notify('✨ Preparando tu voz…');
    if(media?.state==='recording'){
      try{media.stop();return}catch(_){}
    }
    finishRecording();
  }
  async function finishRecording(){
    let pcm=flattenChunks(),rate=captureRate;
    const encoded=encodedChunks.slice(),format=media?.mimeType||encoded[0]?.type;
    media=null;disposeCapture();
    try{
      if(!pcm && encoded.length){
        const blob=new Blob(encoded,{type:format||'audio/mp4'});
        const data=await audioContext().decodeAudioData(await blob.arrayBuffer());
        rate=data.sampleRate;
        pcm=new Float32Array(data.length);
        for(let ch=0;ch<data.numberOfChannels;ch++){
          const samples=data.getChannelData(ch);
          for(let i=0;i<pcm.length;i++)pcm[i]+=samples[i]/data.numberOfChannels;
        }
      }
      if(!pcm)throw new Error('No se pudo decodificar el audio. Vuelve a grabar.');
      const captured=createRecording(pcm,rate);
      if(stage==='host'){freeRecording(host);host=captured;}
      else if(stage==='rival'){freeRecording(rival);rival=captured;}
      processing=false;render();
      notify(stage==='host'?'✅ ¡Frase guardada! Pasa el móvil al rival.':'✅ ¡Imitación lista! Dale al botón azul para escucharla al revés. 🎧');
    }catch(err){
      processing=false;render();notify('⚠️ '+(err.message||'No se pudo procesar la voz.'),true);
    }finally{pcmChunks=[];encodedChunks=[];}
  }
  function playRecording(rec,side){
    if(!rec){notify('🎙️ Primero graba un audio.',true);return;}
    if(recording||processing||pending){notify('Espera a que termine la grabación.');return;}
    const key=(rec===host?'host':'rival')+'-'+side;
    if(currentPlayback===key){stopPlaying();render();notify('⏹️ Reproducción detenida.');return;}
    const url=side==='reverse'?rec.reverseUrl:rec.normalUrl;
    if(!url){notify('El audio no está disponible. Vuelve a grabar.',true);return;}
    stopPlaying();
    // HTMLAudioElement.play() is deliberately called directly in the button click handler.
    // Avoid awaiting AudioContext.resume() before playback: iPhone loses user activation.
    audio.src=url;
    audio.currentTime=0;
    audio.onended=()=>{playing='';currentPlayback='';render();};
    audio.onerror=()=>{stopPlaying();render();notify('⚠️ Error de reproducción. Comprueba el volumen y vuelve a intentarlo.',true);};
    currentPlayback=key;playing=side;render();
    try{
      const promise=audio.play();
      if(promise?.catch)promise.catch(err=>{
        if(currentPlayback!==key)return;
        stopPlaying();render();
        notify('⚠️ El móvil bloqueó el audio. Toca de nuevo el botón y comprueba que Safari tiene sonido. '+(err?.name||''),true);
      });
    }catch(err){stopPlaying();render();notify('⚠️ No se puede reproducir el audio: '+err.message,true);}
  }
  function toHandoff(){
    if(!host){notify('🎙️ Graba primero tu frase secreta.',true);return;}
    if(recording||processing||pending)return;
    stopPlaying();
    stage='handoff';$('handoff').hidden=false;render();
  }
  function toRival(){
    if(!host)return;
    stage='rival';$('handoff').hidden=true;render();
    notify('🎧 Escucha el sonido invertido con el botón verde. ¡Después imítalo!');
  }
  function toReveal(){
    if(!rival)return;
    stopPlaying();stage='reveal';
    const actual=$('secretInput').value.trim();
    const guess=$('guessInput').value.trim();
    $('answerText').textContent=actual?'💬 La frase secreta era: «'+actual+'»':'🎧 Pulsa el botón verde para escuchar lo que dijo realmente el jugador 1.';
    $('guessText').textContent=guess?'🤔 El rival respondió: «'+guess+'»':'';
    render();notify('🥳 ¡Reto completado! Ahora escucha la frase original.');
  }
  function resetRound(){
    stopPlaying();freeRecording(host);freeRecording(rival);
    host=null;rival=null;pcmChunks=[];encodedChunks=[];
    $('secretInput').value='';$('guessInput').value='';
    stage='host';recording=false;processing=false;pending=false;
    render();notify('🎙️ ¡Nueva ronda! Graba una frase en secreto.');
  }
  function iconFor(el,type){el.innerHTML=icons[type];}
  function setTile(which,icon,label,detail,active=false){
    const item=buttons[which],identifier=which==='red'?'record':which==='green'?'original':'reverse';
    iconFor($(identifier+'Icon'),icon);
    $(identifier+'Label').textContent=label;$(identifier+'Detail').textContent=detail;
    item.classList.toggle('is-playing',active&&!!currentPlayback);
    item.classList.toggle('is-recording',which==='red'&&recording);
    item.disabled=processing||pending;
  }
  function render(){
    const hostTurn=stage==='host',rivalTurn=stage==='rival',reveal=stage==='reveal';
    $('secretPanel').hidden=!hostTurn;
    $('guessPanel').hidden=!(rivalTurn&&!!rival);
    $('revealPanel').hidden=!reveal;
    $('handoff').hidden=stage!=='handoff';
    $('stageBadge').textContent=hostTurn?'🎙️ JUGADOR 1':reveal?'🎉 ¡REVELACIÓN!':'🎧 JUGADOR 2';
    $('stageTitle').textContent=hostTurn?'Graba una frase secreta':reveal?'¿Has acertado? 🤯':'¡Imita lo que oyes al revés!';
    $('stageHint').textContent=hostTurn?'Tu rival no debe escuchar la voz original. 🤫':
      reveal?'Compara la voz original con la imitación invertida.':
      'Escucha el reto en reversa, repítelo con tu voz y adivina.';
    const press=recording?'⏹ Detener grabación':pending?'🎙️ Activando micro…':processing?'✨ Procesando…':'🎙️ Toca para grabar · máximo 15 s';
    if(hostTurn){
      setTile('red',recording?'stop':'mic',recording?'Detener grabación':host?'Volver a grabar':'Grabar secreto',press);
      setTile('green','play',currentPlayback==='host-normal'?'⏹ Detener original':'Escuchar mi frase',host?'▶️ Comprueba la grabación':'▶️ Se activa cuando grabes',currentPlayback==='host-normal');
      setTile('blue','next','Pasar al rival',host?'➡️ ¡Tu turno ha terminado!':'➡️ Graba primero tu secreto');
    }else if(rivalTurn||stage==='handoff'){
      setTile('red',recording?'stop':'mic',recording?'Detener grabación':rival?'Repetir imitación':'Grabar imitación',press);
      setTile('green','reverse',currentPlayback==='host-reverse'?'⏹ Detener audio':'Escuchar el reto', '⏪ La frase secreta al revés',currentPlayback==='host-reverse');
      setTile('blue','reverse',currentPlayback==='rival-reverse'?'⏹ Detener audio':'Mi voz al revés',rival?'🤪 ¿Se parece a una frase real?':'⏪ Primero graba tu imitación',currentPlayback==='rival-reverse');
    }else{
      setTile('red','refresh','Nueva ronda','🎙️ ¡Vamos a jugar otra vez!');
      setTile('green','play',currentPlayback==='host-normal'?'⏹ Detener original':'Escuchar original','▶️ ¡Esta era la frase secreta!',currentPlayback==='host-normal');
      setTile('blue','reverse',currentPlayback==='rival-reverse'?'⏹ Detener imitación':'Imitación al revés','⏪ ¡Escucha lo que consiguió el rival!',currentPlayback==='rival-reverse');
    }
    $('filterToggle').checked=filterEnabled;
  }
  function onRed(){
    if(stage==='reveal')return resetRound();
    if(recording)return endRecording();
    if(stage==='host'||stage==='rival')return beginRecording();
  }
  function onGreen(){
    if(stage==='host')return playRecording(host,'normal');
    if(stage==='rival')return playRecording(host,'reverse');
    if(stage==='reveal')return playRecording(host,'normal');
  }
  function onBlue(){
    if(stage==='host')return toHandoff();
    if(stage==='rival')return playRecording(rival,'reverse');
    if(stage==='reveal')return playRecording(rival,'reverse');
  }
  function openPanel(name){
    for(const [panel,btn] of [['helpPanel','helpButton'],['filterPanel','filterButton']]){
      const show=panel===name && $(panel).hidden;
      $(panel).hidden=!show;$(btn).setAttribute('aria-expanded',String(show));
    }
  }
  buttons.red.addEventListener('click',onRed);
  buttons.green.addEventListener('click',onGreen);
  buttons.blue.addEventListener('click',onBlue);
  $('rivalReadyButton').addEventListener('click',toRival);
  $('revealButton').addEventListener('click',toReveal);
  $('newRoundButton').addEventListener('click',resetRound);
  $('helpButton').addEventListener('click',()=>openPanel('helpPanel'));
  $('filterButton').addEventListener('click',()=>openPanel('filterPanel'));
  $('filterToggle').addEventListener('change',e=>{
    if(recording||processing||pending){e.target.checked=filterEnabled;notify('⏳ Termina la grabación antes de cambiar los ajustes.');return;}
    filterEnabled=e.target.checked;notify(filterEnabled?'✨ Filtro de voz activado para la próxima grabación.':'🎧 Filtro adicional desactivado para la próxima grabación.');
  });
  $('shareButton').addEventListener('click',()=>{
    const url='https://ayyoub1616.github.io/voicegame/';
    const message='🎙️⏪ ¡Te reto a adivinar mi voz al revés! REWIND!';
    try{
      if(navigator.share){const p=navigator.share({title:'REWIND! — reto para dos',text:message,url});p?.catch(err=>{if(err.name!=='AbortError')notify('📲 Comparte este enlace: '+url);});}
      else if(navigator.clipboard?.writeText)navigator.clipboard.writeText(message+' '+url).then(()=>notify('✅ ¡Enlace copiado para compartir!')).catch(()=>notify(url));
      else notify('📲 Comparte este enlace: '+url);
    }catch(_){notify('📲 Comparte este enlace: '+url);}
  });
  window.addEventListener('pagehide',()=>{
    clearTimer();stopPlaying();if(media?.state==='recording')try{media.stop()}catch(_){}
    disposeCapture();freeRecording(host);freeRecording(rival);
  });
  render();
  if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')){
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  }
})();