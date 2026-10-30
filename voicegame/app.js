/* REWIND! — ultra-simple 3-button audio game. Processing is 100% on device. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const record=$('recordButton'),normal=$('originalButton'),reverse=$('reverseButton');
  let state='idle',recording=null,tracks=null,ctx=null,original=null,clean=null,filter=true;
  let currentSource=null,playing='',tick=null,started=0;
  const LIMIT=15;
  try{localStorage.removeItem('voicegame-local-profiles-v2')}catch(_){}

  function feedback(message,invalid=false){
    const element=$('feedback');
    element.textContent=message;
    element.classList.toggle('has-error',invalid);
  }
  function audioContext(){
    if(!ctx){
      const AudioContext=window.AudioContext||window.webkitAudioContext;
      if(!AudioContext)throw new Error('Tu navegador no permite reproducir audio.');
      ctx=new AudioContext();
    }
    return ctx;
  }
  function shownBuffer(){return filter&&clean?clean:original}
  function stopAudio(){
    const src=currentSource;
    currentSource=null;playing='';
    if(src){src.onended=null;try{src.stop()}catch(_){}try{src.disconnect()}catch(_){}}
  }
  function stopTracks(){
    if(tracks){tracks.getTracks().forEach(track=>track.stop());tracks=null;}
  }
  function reverseBuffer(buffer){
    const context=audioContext();
    const out=context.createBuffer(buffer.numberOfChannels,buffer.length,buffer.sampleRate);
    for(let ch=0;ch<buffer.numberOfChannels;ch++){
      const from=buffer.getChannelData(ch),to=out.getChannelData(ch);
      for(let i=0,n=from.length;i<n;i++)to[i]=from[n-1-i];
    }
    return out;
  }
  function update(){
    const isRec=state==='recording',busy=state==='processing'||state==='requesting',ready=state==='ready';
    record.disabled=busy;
    record.classList.toggle('is-active',isRec);
    record.classList.toggle('is-processing',busy);
    record.setAttribute('aria-pressed',String(isRec));
    record.setAttribute('aria-label',isRec?'Detener grabación':ready?'Grabar de nuevo':'Empezar a grabar');
    $('recordIcon').innerHTML=isRec
      ? '<rect x="31" y="31" width="38" height="38" rx="7" fill="currentColor"/>'
      : '<rect x="38" y="15" width="24" height="46" rx="12" fill="currentColor"/><path d="M26 49a24 24 0 0 0 48 0M50 73v15M37 88h26" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>';
    $('recordLabel').textContent=isRec?'Detener grabación':busy?'Preparando…':ready?'Volver a grabar':'Empezar a grabar';
    $('recordCaption').textContent=isRec?'🔴 Grabando tu voz':ready?'🔁 Graba una nueva frase':'🎙️ Toca para empezar';
    $('recordTimer').hidden=!isRec;
    for(const [button,key,text,label,caption,emoji] of [
      [normal,'original','Escuchar original','originalLabel','originalCaption','▶️'],
      [reverse,'reverse','Escuchar reversa','reverseLabel','reverseCaption','⏪']
    ]){
      const active=playing===key;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-pressed',String(active));
      button.setAttribute('aria-label',active?'Detener reproducción':text);
      $(label).textContent=active?'Detener audio':text;
      $(caption).textContent=active?emoji+' Reproduciendo…':
        key==='original'?'▶️ Tu voz tal como la grabaste':'⏪ ¡Dale la vuelta a tu voz!';
    }
    $('filterToggle').checked=filter;
  }
  async function cleanVoice(buffer){
    const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    if(!Offline)return buffer;
    const offline=new Offline(buffer.numberOfChannels,buffer.length,buffer.sampleRate);
    const source=offline.createBufferSource();
    source.buffer=buffer;
    const low=offline.createBiquadFilter();low.type='highpass';low.frequency.value=105;low.Q.value=.65;
    const high=offline.createBiquadFilter();high.type='lowpass';high.frequency.value=6500;high.Q.value=.7;
    const compressor=offline.createDynamicsCompressor();
    compressor.threshold.value=-26;compressor.knee.value=18;compressor.ratio.value=2.2;
    compressor.attack.value=.012;compressor.release.value=.23;
    source.connect(low);low.connect(high);high.connect(compressor);compressor.connect(offline.destination);
    source.start();
    const filtered=await offline.startRendering();
    // Adaptive, soft noise gate: reduces low-volume hiss between words without hard cuts.
    const processed=audioContext().createBuffer(filtered.numberOfChannels,filtered.length,filtered.sampleRate);
    const mono=filtered.getChannelData(0);
    const size=Math.max(192,Math.floor(filtered.sampleRate*.025));
    const energy=[];
    for(let i=0;i<mono.length;i+=size){
      let sum=0;
      const n=Math.min(size,mono.length-i);
      for(let k=0;k<n;k++){const sample=mono[i+k];sum+=sample*sample;}
      energy.push(Math.sqrt(sum/Math.max(1,n)));
    }
    const sorted=[...energy].sort((a,b)=>a-b);
    const ambient=sorted[Math.floor(sorted.length*.18)]||0;
    const threshold=Math.max(.005,Math.min(.025,ambient*1.7));
    const inputs=Array.from({length:filtered.numberOfChannels},(_,i)=>filtered.getChannelData(i));
    const outputs=Array.from({length:processed.numberOfChannels},(_,i)=>processed.getChannelData(i));
    let gain=1,max=0;
    for(let i=0;i<filtered.length;i++){
      const loud=energy[Math.min(energy.length-1,Math.floor(i/size))]||0;
      const desired=loud>=threshold?1:.38+.62*Math.pow(Math.min(1,loud/threshold),1.2);
      gain=desired>gain?gain+(desired-gain)*.28:gain+(desired-gain)*.0008;
      for(let ch=0;ch<inputs.length;ch++){
        const value=inputs[ch][i]*gain;
        outputs[ch][i]=value;max=Math.max(max,Math.abs(value));
      }
    }
    const amplification=max>.002?Math.min(1.4,.86/max):1;
    if(amplification!==1)for(const dest of outputs)for(let i=0;i<dest.length;i++)dest[i]=Math.max(-1,Math.min(1,dest[i]*amplification));
    return processed;
  }
  function getMime(){
    if(typeof MediaRecorder.isTypeSupported!=='function')return '';
    return ['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type))||'';
  }
  function clearTimer(){if(tick){clearInterval(tick);tick=null}}
  function clock(sec){
    return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(Math.floor(sec%60)).padStart(2,'0');
  }
  async function startRecord(){
    if(state==='recording'||state==='processing'||state==='requesting')return;
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){
      feedback('🎙️ Abre el juego desde HTTPS y autoriza el micrófono.',true);return;
    }
    stopAudio();
    original=null;clean=null;state='requesting';update();
    feedback('🎙️ Permite el micrófono para grabar.');
    try{
      tracks=await navigator.mediaDevices.getUserMedia({
        audio:{noiseSuppression:true,echoCancellation:true,autoGainControl:true,channelCount:1},
        video:false
      });
      const mime=getMime();
      const media=new MediaRecorder(tracks,mime?{mimeType:mime}:undefined);
      const parts=[];
      media.ondataavailable=e=>{if(e.data&&e.data.size)parts.push(e.data)};
      media.onerror=()=>feedback('No se pudo grabar. Inténtalo otra vez.',true);
      media.onstop=async()=>{
        clearTimer();stopTracks();recording=null;
        state='processing';update();feedback('✨ Preparando tu voz…');
        try{
          if(!parts.length)throw new Error('La grabación está vacía.');
          const audio=new Blob(parts,{type:media.mimeType||mime||parts[0].type});
          const decoded=await audioContext().decodeAudioData(await audio.arrayBuffer());
          if(decoded.duration<.2)throw new Error('Habla durante un poco más de tiempo.');
          original=decoded;
          if(filter){try{clean=await cleanVoice(original)}catch(_){clean=null;}}
          state='ready';
          feedback('✅ ¡Ya está! Pulsa verde o azul para escuchar. 🎧');
        }catch(error){
          original=null;clean=null;state='idle';
          feedback('⚠️ '+(error.message||'No se pudo procesar la grabación.'),true);
        }finally{update()}
      };
      recording=media;media.start(250);
      started=performance.now();state='recording';update();
      feedback('🔴 Grabando… ¡di algo divertido! 😜');
      tick=setInterval(()=>{
        if(state!=='recording')return;
        const elapsed=Math.min(LIMIT,(performance.now()-started)/1000);
        $('recordTimer').textContent=clock(elapsed)+' / 00:15';
        if(elapsed>=LIMIT)stopRecord();
      },110);
    }catch(error){
      clearTimer();stopTracks();recording=null;
      state='idle';update();
      const m=error.name==='NotAllowedError'?'Activa el permiso del micrófono en Safari o Chrome.':error.name==='NotFoundError'?'No se encuentra un micrófono disponible.':(error.message||'No se puede grabar.');
      feedback('⚠️ '+m,true);
    }
  }
  function stopRecord(){
    if(state!=='recording'||!recording)return;
    clearTimer();
    state='processing';update();
    try{recording.stop();}
    catch(_){recording=null;stopTracks();state='idle';feedback('⚠️ No se pudo detener la grabación.',true);update();}
  }
  async function play(kind){
    if(state!=='ready'||!shownBuffer()){
      feedback(state==='processing'||state==='requesting'?'✨ Preparando el audio…':'🎙️ Primero pulsa el botón rojo para grabar.');
      return;
    }
    if(playing===kind){stopAudio();update();feedback('⏹️ Reproducción detenida.');return;}
    stopAudio();
    try{
      const context=audioContext();
      await context.resume();
      const source=context.createBufferSource();
      source.buffer=kind==='reverse'?reverseBuffer(shownBuffer()):shownBuffer();
      source.connect(context.destination);
      currentSource=source;playing=kind;
      source.onended=()=>{
        if(currentSource!==source)return;
        source.disconnect();currentSource=null;playing='';update();
      };
      source.start();
      update();
      feedback(kind==='reverse'?'⏪ ¡Tu voz al revés! 🤪':'▶️ Escuchando tu voz original. 🎧');
    }catch(error){
      stopAudio();update();feedback('⚠️ No se puede reproducir: '+(error.message||'error'),true);
    }
  }
  function openPanel(name){
    for(const [id,button] of [['helpPanel','helpButton'],['filterPanel','filterButton']]){
      const shouldShow=id===name && $(id).hidden;
      $(id).hidden=!shouldShow;
      $(button).setAttribute('aria-expanded',String(shouldShow));
    }
  }
  record.addEventListener('click',()=>state==='recording'?stopRecord():startRecord());
  normal.addEventListener('click',()=>play('original'));
  reverse.addEventListener('click',()=>play('reverse'));
  $('helpButton').addEventListener('click',()=>openPanel('helpPanel'));
  $('filterButton').addEventListener('click',()=>openPanel('filterPanel'));
  $('filterToggle').addEventListener('change',async event=>{
    if(state==='recording'||state==='processing'||state==='requesting'){
      event.target.checked=filter;feedback('⏳ Espera a que termine la grabación.');return;
    }
    filter=event.target.checked;
    stopAudio();
    if(filter&&original&&!clean){
      state='processing';update();
      try{clean=await cleanVoice(original)}catch(_){clean=null}
      state='ready';
    }
    update();
    feedback(filter?'✨ Filtro de voz activado.':'🎧 Filtro desactivado: audio sin el filtro adicional.');
  });
  $('shareButton').addEventListener('click',async()=>{
    const url='https://ayyoub1616.github.io/voicegame/';
    try{
      if(navigator.share)await navigator.share({title:'REWIND! 🎙️',text:'😂 ¡Prueba tu voz al revés!',url});
      else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);feedback('🔗 Enlace copiado para compartir.');}
      else feedback('🔗 Comparte este enlace: '+url);
    }catch(error){if(error.name!=='AbortError')feedback('🔗 Comparte este enlace: '+url);}
  });
  window.addEventListener('pagehide',()=>{
    clearTimer();stopAudio();
    if(recording?.state==='recording')try{recording.stop()}catch(_){}
    stopTracks();
  });
  update();
  if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')){
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  }
})();