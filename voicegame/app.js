/* REWIND! — two-player reverse-speech challenge. No accounts or server uploads. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const t = (key,vars) => window.REWIND_L10N?.t(key,vars) || key;
  let notice={key:'feedbackInit',vars:null,error:false};
  const say=(key,vars=null,error=false)=>{notice={key,vars,error};notify(t(key,vars),error);};
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
      if(!Type)throw new Error(t('recordUnsupported'));
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
    // 1. Restrict the signal to the normal speech band to remove low hum and high hiss.
    //    A gentle, frame-based expander then reduces background noise between words.
    //    The built-in browser noise/echo suppression acts before this stage.
    const filtered=new Float32Array(pcm.length);
    const high=Math.exp(-2*Math.PI*100/rate);
    const low=Math.exp(-2*Math.PI*Math.min(7000,rate*.44)/rate);
    let lastIn=0,lastHigh=0,lastLow=0;
    for(let i=0;i<pcm.length;i++){
      const highValue=high*(lastHigh+pcm[i]-lastIn);
      lastIn=pcm[i];lastHigh=highValue;
      lastLow=(1-low)*highValue+low*lastLow;
      filtered[i]=lastLow;
    }
    // 2. Estimate the noise floor from the quietest 20 ms sections. This threshold
    //    adapts to microphone noise without assuming the user starts in silence.
    const frameSize=Math.max(192,Math.round(rate*.02));
    const count=Math.ceil(filtered.length/frameSize);
    const energy=new Float32Array(count);
    for(let f=0;f<count;f++){
      const from=f*frameSize,to=Math.min(filtered.length,from+frameSize);
      let power=0;
      for(let j=from;j<to;j++)power+=filtered[j]*filtered[j];
      energy[f]=Math.sqrt(power/Math.max(1,to-from));
    }
    const order=Array.from(energy).sort((a,b)=>a-b);
    const floor=order[Math.min(order.length-1,Math.floor(order.length*.17))]||0;
    const threshold=Math.max(.006,Math.min(.035,floor*2.35));
    // 3. Soft noise gate, with short attack and long release. Hard gates clip
    //    quiet syllables; attenuation is deliberately limited to 16%.
    const out=new Float32Array(filtered.length);
    const attack=Math.exp(-1/(rate*.005));
    const release=Math.exp(-1/(rate*.12));
    let gain=.16,peak=0; // Silence starts attenuated; voice opens the gate within ~5 ms.
    for(let i=0;i<filtered.length;i++){
      const rms=energy[Math.min(count-1,Math.floor(i/frameSize))]||0;
      const relative=Math.min(1,rms/threshold);
      const target=.16+.84*relative*relative;
      const smoothing=target>gain?attack:release;
      gain=target+(gain-target)*smoothing;
      const value=filtered[i]*gain;
      out[i]=value;
      peak=Math.max(peak,Math.abs(value));
    }
    // 4. Conservative automatic normalization; limiter prevents clipping.
    const boost=peak>.003?Math.min(2.2,.86/peak):1;
    if(boost!==1)for(let i=0;i<out.length;i++){
      out[i]=Math.max(-.98,Math.min(.98,out[i]*boost));
    }
    return out;
  }
  function createRecording(pcm,rate){
    if(!pcm?.length)throw new Error(t('audioEmpty'));
    if(pcm.length/rate<.22)throw new Error(t('recordLonger'));
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
    if(!navigator.mediaDevices?.getUserMedia){say('micHttps',null,true);return;}
    if(stage!=='host'&&stage!=='rival')return;
    stopPlaying();pending=true;render();say('micAllow');
    try {
      // Unlock WebAudio inside a real tap on iPhone. Actual playback uses native HTML audio.
      const ctx=audioContext();
      ctx.resume().catch(()=>{});
      micStream=await navigator.mediaDevices.getUserMedia({
        audio:{echoCancellation:{ideal:true},noiseSuppression:{ideal:true},autoGainControl:{ideal:false},channelCount:{ideal:1}},
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
          media.onerror=()=>say('errorRecording',null,true);
        } catch (err) {
          media=null;
          if(!pcmAvailable)throw err;
        }
      }else if(!pcmAvailable)throw new Error(t('recordUnsupported'));
      recording=true;pending=false;
      if(media)media.start(200);
      begin=performance.now();render();
      say('recordingNow');
      clockId=setInterval(()=>{
        if(!recording)return;
        $('recordDetail').textContent='🔴 '+timerLabel((performance.now()-begin)/1000)+' / 00:15';
        if((performance.now()-begin)/1000>=LIMIT)endRecording();
      },110);
    }catch(err){
      pending=false;recording=false;processing=false;media=null;
      disposeCapture();render();
      const key=err.name==='NotAllowedError'?'micDenied':err.name==='NotFoundError'?'micMissing':'micFailure';
      say(key,null,true);
    }
  }
  function endRecording(){
    if(!recording)return;
    recording=false;processing=true;clearTimer();render();
    say('audioPreparing');
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
      if(!pcm)throw new Error(t('cannotDecode'));
      const captured=createRecording(pcm,rate);
      if(stage==='host'){freeRecording(host);host=captured;}
      else if(stage==='rival'){freeRecording(rival);rival=captured;}
      processing=false;render();
      say(stage==='host'?'savedHost':'savedRival');
    }catch(err){
      processing=false;render();notify('⚠️ '+(err.message||t('micFailure')),true);notice=null;
    }finally{pcmChunks=[];encodedChunks=[];}
  }
  function playRecording(rec,side){
    if(!rec){say('playFirst',null,true);return;}
    if(recording||processing||pending){say('waitRecord');return;}
    const key=(rec===host?'host':'rival')+'-'+side;
    if(currentPlayback===key){stopPlaying();render();say('playStopped');return;}
    const url=side==='reverse'?rec.reverseUrl:rec.normalUrl;
    if(!url){say('audioUnavailable',null,true);return;}
    stopPlaying();
    // HTMLAudioElement.play() is deliberately called directly in the button click handler.
    // Avoid awaiting AudioContext.resume() before playback: iPhone loses user activation.
    audio.src=url;
    audio.currentTime=0;
    audio.onended=()=>{playing='';currentPlayback='';render();};
    audio.onerror=()=>{stopPlaying();render();say('errorAudio',null,true);};
    currentPlayback=key;playing=side;render();
    try{
      const promise=audio.play();
      if(promise?.catch)promise.catch(err=>{
        if(currentPlayback!==key)return;
        stopPlaying();render();
        say('audioBlocked',null,true);
      });
    }catch(err){stopPlaying();render();say('errorAudio',null,true);}
  }
  function toHandoff(){
    if(!host){say('passNeed',null,true);return;}
    if(recording||processing||pending)return;
    stopPlaying();
    stage='handoff';$('handoff').hidden=false;render();
  }
  function toRival(){
    if(!host)return;
    stage='rival';$('handoff').hidden=true;render();
    say('rivalGo');
  }
  function toReveal(){
    if(!rival)return;
    stopPlaying();stage='reveal';
    const actual=$('secretInput').value.trim();
    const guess=$('guessInput').value.trim();
    $('answerText').textContent=actual?t('secretWas',{value:actual}):t('answerByVoice');
    $('guessText').textContent=guess?t('guessed',{value:guess}):'';
    render();say('revealDone');
  }
  function resetRound(){
    stopPlaying();freeRecording(host);freeRecording(rival);
    host=null;rival=null;pcmChunks=[];encodedChunks=[];
    $('secretInput').value='';$('guessInput').value='';
    stage='host';recording=false;processing=false;pending=false;
    render();say('roundReset');
  }
  function iconFor(el,type){el.innerHTML=icons[type];}
  function setTile(which,icon,label,detail,active=false){
    const item=buttons[which],identifier=which==='red'?'record':which==='green'?'original':'reverse';
    iconFor($(identifier+'Icon'),icon);
    $(identifier+'Label').textContent=label;$(identifier+'Detail').textContent=detail;
    item.setAttribute('aria-label',label);
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
    $('stageBadge').textContent=t(hostTurn?'badgeHost':reveal?'badgeReveal':'badgeRival');
    $('stageTitle').textContent=t(hostTurn?'titleHost':reveal?'titleReveal':'titleRival');
    $('stageHint').textContent=t(hostTurn?'hintHost':reveal?'hintReveal':'hintRival');
    const press=t(recording?'stopRecord':pending?'startingMic':processing?'processing':'recordHint');
    if(hostTurn){
      setTile('red',recording?'stop':'mic',t(recording?'stopRecord':host?'recordAgain':'recordSecret'),press);
      setTile('green','play',t(currentPlayback==='host-normal'?'stopOriginal':'checkVoice'),t(host?'checkVoiceDetail':'onlyAfterRecording'),currentPlayback==='host-normal');
      setTile('blue','next',t('passRival'),t(host?'passReady':'passFirst'));
    }else if(rivalTurn||stage==='handoff'){
      setTile('red',recording?'stop':'mic',t(recording?'stopRecord':rival?'retryImitate':'imitate'),press);
      setTile('green','reverse',t(currentPlayback==='host-reverse'?'stopAudio':'listenChallenge'), t('reverseSecretDetail'),currentPlayback==='host-reverse');
      setTile('blue','reverse',t(currentPlayback==='rival-reverse'?'stopAudio':'myVoiceReverse'),t(rival?'myVoiceDetail':'imitationFirst'),currentPlayback==='rival-reverse');
    }else{
      setTile('red','refresh',t('newRound'),t('letsPlay'));
      setTile('green','play',t(currentPlayback==='host-normal'?'stopOriginal':'playOriginal'),t('revealOriginal'),currentPlayback==='host-normal');
      setTile('blue','reverse',t(currentPlayback==='rival-reverse'?'stopImitation':'playRival'),t('revealRival'),currentPlayback==='rival-reverse');
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
    if(recording||processing||pending){e.target.checked=filterEnabled;say('settingsWait');return;}
    filterEnabled=e.target.checked;say(filterEnabled?'filterOn':'filterOff');
  });
  $('shareButton').addEventListener('click',()=>{
    const url='https://ayyoub1616.github.io/voicegame/';
    const message=t('shareMessage');
    try{
      if(navigator.share){const p=navigator.share({title:t('shareTitle'),text:message,url});p?.catch(err=>{if(err.name!=='AbortError')say('shareLink',{value:url});});}
      else if(navigator.clipboard?.writeText)navigator.clipboard.writeText(message+' '+url).then(()=>say('shareCopied')).catch(()=>say('shareLink',{value:url}));
      else say('shareLink',{value:url});
    }catch(_){say('shareLink',{value:url});}
  });
  window.addEventListener('pagehide',()=>{
    clearTimer();stopPlaying();if(media?.state==='recording')try{media.stop()}catch(_){}
    disposeCapture();freeRecording(host);freeRecording(rival);
  });
  window.addEventListener('rewind:language',()=>{
    render();
    if(stage==='reveal'){
      const actual=$('secretInput').value.trim(),guess=$('guessInput').value.trim();
      $('answerText').textContent=actual?t('secretWas',{value:actual}):t('answerByVoice');
      $('guessText').textContent=guess?t('guessed',{value:guess}):'';
    }
    if(notice)notify(t(notice.key,notice.vars),notice.error);
  });
  render();
  if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')){
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  }
})();