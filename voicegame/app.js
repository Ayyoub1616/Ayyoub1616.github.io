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
  const G=window.REWIND_GAMES;
  const savedMode=(()=>{try{return localStorage.getItem('rewind-game-mode')}catch(_){return null}})();
  const linkedMode=new URLSearchParams(location.search).get('game');
  let modeId=G.all.some(g=>g.id===linkedMode)?linkedMode:G.all.some(g=>g.id===savedMode)?savedMode:'reverse';
  let promptIndex=0,chainIndex=1,chainPlayers=4,chainRecordings=[],winner='';
  // Player names are optional, kept only in this page's memory, and not uploaded.
  const playerNames=Array(6).fill('');
  const mode=()=>G.get(modeId),chainMode=()=>mode().kind==='chain',duelMode=()=>mode().kind==='duel',partyMode=()=>mode().kind==='party';
  let partyIndex=0,partyPromptIndex=0,partyHidden=false,partyReveal=false,partyDare=false,partyRemaining=0,partyTimerId=null;
  const partyScores=Array(6).fill(0);
  const participantCount=()=>chainMode()?chainPlayers:partyMode()&&mode().group==='groups'?chainPlayers:2;
  const timeLimit=()=>mode().limit||15;
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
        $('recordDetail').textContent='🔴 '+timerLabel((performance.now()-begin)/1000)+' / '+timerLabel(timeLimit());
        if(modeId==='speed')updateSpeedClock();
        if((performance.now()-begin)/1000>=timeLimit())endRecording();
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
      if(stage==='host'){
        freeRecording(host);host=captured;
        if(chainMode())chainRecordings[0]=host;
      }
      else if(stage==='rival'){
        if(chainMode()){
          if(chainRecordings[chainIndex])freeRecording(chainRecordings[chainIndex]);
          chainRecordings[chainIndex]=captured;
          rival=captured;
        }else{freeRecording(rival);rival=captured;}
      }
      processing=false;render();
      say(stage==='host'?'savedHost':'savedRival');
    }catch(err){
      processing=false;render();notify('⚠️ '+(err.message||t('micFailure')),true);notice=null;
    }finally{pcmChunks=[];encodedChunks=[];}
  }
  function playRecording(rec,side){
    if(!rec){say('playFirst',null,true);return;}
    if(recording||processing||pending){say('waitRecord');return;}
    const key=(rec===host?'host':chainMode()?('chain'+chainRecordings.indexOf(rec)):'rival')+'-'+side;
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
    $('answerText').textContent=duelMode()?G.msg('duelReveal'):chainMode()?G.msg('chainResult'):(actual?t('secretWas',{value:actual}):t('answerByVoice'));
    $('guessText').textContent=guess?t('guessed',{value:guess}):'';
    render();say('revealDone');
  }
  function resetRound(){
    stopPartyTimer();
    stopPlaying();freeRecording(host);freeRecording(rival);
    for(const rec of chainRecordings)if(rec!==host&&rec!==rival)freeRecording(rec);
    host=null;rival=null;chainRecordings=[];chainIndex=1;winner='';pcmChunks=[];encodedChunks=[];
    $('secretInput').value='';$('guessInput').value='';
    stage='host';recording=false;processing=false;pending=false;
    render();say('roundReset');
  }
  function populateGames(){
    const select=$('gameSelect');select.replaceChildren();
    for(const group of ['friends','couples','groups']){
      const section=document.createElement('optgroup');
      section.label=G.msg(group);
      for(const g of G.all.filter(g=>g.group===group)){
        const option=document.createElement('option');
        option.value=g.id;option.textContent=G.title(g.id);
        section.append(option);
      }
      select.append(section);
    }
    select.value=modeId;
  }
  function currentSource(){return chainMode()?chainRecordings[chainIndex-1]:host}
  function finalRecord(){return chainMode()?chainRecordings[chainRecordings.length-1]:rival}
  function pickPrompt(){
    const next=1+Math.floor(Math.random()*3);
    promptIndex=(promptIndex+next)%4;
    $('promptText').textContent=G.prompt(modeId,promptIndex);
  }
  function changeGame(next){
    if(recording||processing||pending){$('gameSelect').value=modeId;return;}
    if(next===modeId)return;
    if((host||rival)&&!window.confirm(G.msg('resetConfirm'))){$('gameSelect').value=modeId;return;}
    resetRound();
    modeId=next;promptIndex=0;
    if(chainMode()&&chainPlayers<3)chainPlayers=3;
    resetParty();
    if(chainMode()||partyMode())$('playerNamesPanel').open=true;
    try{localStorage.setItem('rewind-game-mode',modeId)}catch(_){}
    render();
  }
  function nextInChain(){
    if(!chainMode()||stage!=='rival'||!rival||chainIndex>=chainPlayers-1)return;
    stopPlaying();
    chainIndex++;
    rival=null;
    stage='handoff';
    render();
  }
  function participantName(index){
    return playerNames[index]?.trim()||G.msg('nameLabel',{value:index+1});
  }
  function hasName(index){return !!playerNames[index]?.trim()}
  function activePerson(){
    return partyMode()?partyIndex:stage==='host'?0:stage==='rival'||stage==='handoff'?chainMode()?chainIndex:1:-1;
  }
  function renderPlayerNames(){
    const count=participantCount(),wrap=$('playerNamesFields');
    $('playerNamesSummary').firstChild.textContent=G.msg('namesTitle')+' ';
    $('playerNamesSummary').querySelector('span').textContent=G.msg('namesOptional');
    $('playerNamesInfo').textContent=G.msg('namesInfo');
    if(wrap.children.length!==count){
      wrap.replaceChildren();
      for(let index=0;index<count;index++){
        const label=document.createElement('label');
        label.className='player-name-field';
        const icon=document.createElement('span');
        icon.textContent=index===0?'🎙️':index===1?'🎧':'👤';
        icon.setAttribute('aria-hidden','true');
        const input=document.createElement('input');
        input.type='text';input.maxLength=22;input.autocomplete='off';
        input.value=playerNames[index]||'';
        input.dataset.index=String(index);
        input.addEventListener('input',e=>{
          const name=e.target.value.replace(/[\r\n]/g,'').slice(0,22);
          playerNames[index]=name;
          // Do not redraw input controls while the user is typing.
          render();
        });
        label.append(icon,input);wrap.append(label);
      }
    }
    [...wrap.querySelectorAll('input')].forEach((input,index)=>{
      const label=G.msg('namePlaceholder',{value:index+1});
      input.placeholder=label;input.setAttribute('aria-label',label);
      input.disabled=recording||processing||pending;
    });
  }
  function renderHistory(){
    const list=$('chainHistory');list.replaceChildren();
    if(!chainMode()||stage!=='reveal')return;
    chainRecordings.forEach((record,i)=>{
      if(!record)return;
      const row=document.createElement('div');row.className='chain-row';
      const title=document.createElement('span');title.className='chain-row-label';title.textContent=G.msg('chainVoiceNamed',{value:participantName(i)});
      const actions=document.createElement('div');actions.className='chain-row-actions';
      for(const [side,label] of [['normal','chainOriginal'],['reverse','chainReverse']]){
        const button=document.createElement('button');button.type='button';button.textContent=G.msg(label);
        button.addEventListener('click',()=>playRecording(record,side));
        actions.append(button);
      }
      row.append(title,actions);list.append(row);
    });
  }
  function chooseWinner(choice){
    if(!duelMode()||stage!=='reveal')return;
    winner=choice;
    $('winnerResult').textContent=choice==='tie'?G.msg('winnerTie'):G.msg('resultNamed',{value:participantName(choice==='one'?0:1)});
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
  function renderGameIdentity(){
    const visual=G.visual(modeId);
    // Every game has its own colors, icons and instructions while keeping
    // the same three familiar record/listen/reverse controls.
    document.body.dataset.game=modeId;
    const colors=visual.colors;
    for(const [name,value] of [['--g-primary',colors[0]],['--g-record',colors[1]],['--g-play',colors[2]],['--g-reverse',colors[3]],['--g-surface',colors[4]]]){
      document.body.style.setProperty(name,value);
    }
    $('sceneCategory').textContent=G.msg(mode().group);
    $('scenePlayers').textContent='👥 '+participantCount();
    $('sceneEmoji').textContent=visual.emoji;
    $('sceneLeft').textContent=visual.left;
    $('sceneRight').textContent=visual.right;
    $('sceneTitle').textContent=G.title(modeId);
    $('sceneSubtitle').textContent=G.description(modeId);
    ['stepOne','stepTwo','stepThree'].forEach((id,index)=>{
      const symbol=['🎙️','⏪','🤯'][index];
      const action=visual.steps[index];
      const emoji=action==='record'?'🎙️':action==='reverse'?'⏪':action==='guess'?'🤯':
        action==='pass'?'📱':action==='listen'?'🎧':action==='vote'?'🏆':
        action==='secret'?'🤫':action==='imitate'?'🎭':action==='laugh'?'🤣':
        action==='act'?'🎬':action==='whisper'?'🤫':action==='beat'?'🥁':
        action==='fast'?'⚡':'🎉';
      $(id).textContent=(emoji||symbol)+' '+G.verb(action);
    });
    $('chainProgress').hidden=!chainMode();
    if(chainMode()){
      const bar=$('chainProgress');
      bar.replaceChildren();
      for(let i=0;i<chainPlayers;i++){
        const badge=document.createElement('div');
        badge.className='chain-player';
        if(chainRecordings[i])badge.classList.add('is-completed');
        const current=stage==='host'?0:stage==='rival'||stage==='handoff'?chainIndex:-1;
        if(i===current)badge.classList.add('is-current');
        const icon=document.createElement('span');icon.className='chain-player-icon';
        icon.textContent=chainRecordings[i]?'✅':i===current?'🎙️':'👤';
        const label=document.createElement('span');label.textContent=playerNames[i]?.trim()||String(i+1);
        label.title=participantName(i);
        badge.append(icon,label);
        bar.append(badge);
      }
    }
    $('duelArena').hidden=!duelMode();
    if(duelMode()){
      for(const [id,isActive,done] of [
        ['duelPersonOne',stage==='host',!!host],
        ['duelPersonTwo',stage==='rival'||stage==='handoff',!!rival]
      ]){
        $(id).classList.toggle('is-current',isActive);
        $(id).classList.toggle('is-done',done);
      }
      $('duelNameOne').textContent=participantName(0);
      $('duelNameTwo').textContent=participantName(1);
    }
    $('speedPanel').hidden=modeId!=='speed';
    if(modeId==='speed')updateSpeedClock();
  }
  function updateSpeedClock(){
    const maximum=timeLimit();
    const elapsed=recording?Math.min(maximum,(performance.now()-begin)/1000):0;
    const remaining=Math.max(0,maximum-elapsed);
    $('speedTitle').textContent='⚡ '+maximum+'s';
    $('speedRemaining').textContent=String(Math.ceil(remaining)).padStart(2,'0');
    $('speedFill').style.width=(remaining/maximum*100).toFixed(1)+'%';
  }

  function stopPartyTimer(){if(partyTimerId){clearInterval(partyTimerId);partyTimerId=null;}}
  function resetParty(){
    stopPartyTimer();partyIndex=0;partyPromptIndex=0;partyHidden=false;partyReveal=false;partyDare=false;
    partyRemaining=mode().seconds||0;partyScores.fill(0);
  }
  function currentPartyPrompt(){
    return partyDare&&modeId==='truthdare'?G.dare(partyPromptIndex):G.prompt(modeId,partyPromptIndex);
  }
  function nextPartyCard(){
    if(!partyMode())return;
    stopPartyTimer();partyPromptIndex=(partyPromptIndex+1)%4;
    partyHidden=false;partyReveal=false;partyRemaining=mode().seconds||0;
    render();notify(G.msg('newRound',{value:participantName(partyIndex)}));
  }
  function nextPartyTurn(){
    if(!partyMode())return;
    stopPartyTimer();partyIndex=(partyIndex+1)%participantCount();
    partyPromptIndex=(partyPromptIndex+1)%4;partyHidden=false;partyReveal=false;partyRemaining=mode().seconds||0;
    render();notify(G.msg('turnFor',{value:participantName(partyIndex)}));
  }
  function startPartyTimer(){
    if(partyTimerId){stopPartyTimer();render();return;}
    if(partyRemaining<=0)partyRemaining=mode().seconds||30;
    let previous=performance.now();
    partyTimerId=setInterval(()=>{
      const now=performance.now();
      partyRemaining=Math.max(0,partyRemaining-(now-previous)/1000);previous=now;
      updatePartyTimer();
      if(partyRemaining<=0){stopPartyTimer();render();notify(G.msg('timeUp'));}
    },90);
    render();notify(G.msg('timerNow'));
  }
  function updatePartyTimer(){
    const maximum=mode().seconds||30;
    $('partyTimerValue').textContent=String(Math.ceil(partyRemaining));
    $('partyTimerFill').style.width=(partyRemaining/maximum*100).toFixed(1)+'%';
    $('partyTimerPanel').classList.toggle('time-almost-up',partyRemaining<=3);
  }
  function partyGreen(){
    if(!partyMode())return;
    const variant=mode().variant;
    if(variant==='timer')return startPartyTimer();
    if(variant==='truthdare'){partyDare=!partyDare;partyHidden=false;partyReveal=false;}
    else if(variant==='reveal')partyReveal=!partyReveal;
    else if(variant==='score'){
      const guesser=(partyIndex+1)%2;
      partyScores[guesser]++;render();notify(G.msg('correct',{value:participantName(guesser)}));return;
    }else partyHidden=!partyHidden;
    render();
  }
  function renderParty(){
    $('handoff').hidden=true;$('secretPanel').hidden=true;$('guessPanel').hidden=true;
    $('chainNextPanel').hidden=true;$('revealPanel').hidden=true;
    $('partyBoard').hidden=false;$('promptBox').hidden=true;
    $('chainControls').hidden=mode().group!=='groups';
    $('chainPlayersLabel').textContent=G.msg('players');
    $('chainPlayers').value=String(chainPlayers);$('chainPlayers').disabled=false;
    const two=$('chainPlayers').querySelector('option[value="2"]');if(two)two.disabled=false;
    $('gameSelectLabel').textContent=G.msg('select');
    $('gameDescription').textContent=G.description(modeId);
    $('gameSelect').value=modeId;$('gameSelect').disabled=false;
    $('playerNamesPanel').hidden=false;renderPlayerNames();
    const name=participantName(partyIndex);
    $('stageBadge').textContent=G.msg('currentPlayer',{value:name});
    $('stageTitle').textContent=G.title(modeId);$('stageHint').textContent=G.description(modeId);
    $('partyPlayer').textContent='🎯 '+G.msg('turnFor',{value:name});
    $('partyQuestion').textContent=partyHidden?G.msg('hidden'):currentPartyPrompt();
    $('partyQuestion').classList.toggle('is-hidden',partyHidden);
    $('partyDirections').textContent=G.msg(mode().variant==='timer'?'timerHelp':mode().variant==='talk'?'voteHelp':'partyHow');
    $('partyAnswer').hidden=!(mode().variant==='reveal'&&partyReveal);
    $('partyAnswer').textContent=mode().variant==='reveal'?G.msg('answerLabel',{value:G.answer(partyPromptIndex)}):'';
    $('partyTimerPanel').hidden=mode().variant!=='timer';
    if(mode().variant==='timer')updatePartyTimer();
    $('partyScore').hidden=mode().variant!=='score';
    if(mode().variant==='score'){
      const scoreboard=$('partyScore');scoreboard.replaceChildren();
      for(let i=0;i<2;i++){
        const chip=document.createElement('span');chip.textContent='🏆 '+participantName(i)+' · '+partyScores[i];
        scoreboard.append(chip);
      }
    }
    $('scenePlayers').textContent='👥 '+participantCount();
    const help=$('helpPanel');help.querySelector('strong').textContent=G.msg('how');
    [...help.querySelectorAll('p')].forEach((p,i)=>p.textContent=G.msg(['partyHelp','partyHow','voteHelp','timerHelp'][i]));
    const variant=mode().variant;
    const green=variant==='timer'?(partyTimerId?'timerPause':partyRemaining<=0?'timerRestart':'timerStart'):
      variant==='truthdare'?(partyDare?'truth':'dare'):
      variant==='reveal'?(partyReveal?'answerHide':'answerShow'):
      variant==='score'?'point':partyHidden?'show':'flip';
    setTile('red','refresh',G.msg('newCard'),'🎲 '+G.msg('question'));
    setTile('green',variant==='timer'?'play':variant==='truthdare'?'refresh':variant==='score'?'next':'play',
      G.msg(green),variant==='timer'?'⏱️ '+String(mode().seconds)+'s':
      variant==='score'?G.msg('score',{value:partyScores[(partyIndex+1)%2]}):G.msg('partyHow'),!!partyTimerId);
    setTile('blue','next',G.msg('skipTurn'),G.msg('passTo',{value:participantName((partyIndex+1)%participantCount())}));
    $('filterToggle').checked=filterEnabled;
  }
  function render(){
    renderGameIdentity();
    if(partyMode()){renderParty();return;}
    $('partyBoard').hidden=true;
    const hostTurn=stage==='host',rivalTurn=stage==='rival',reveal=stage==='reveal';
    $('secretPanel').hidden=!hostTurn || duelMode();
    $('guessPanel').hidden=!(rivalTurn&&!!rival&&(!chainMode()||chainIndex>=chainPlayers-1));
    $('guessPanel').querySelector('label').hidden=duelMode();
    $('guessInput').hidden=duelMode();
    $('chainNextPanel').hidden=!(rivalTurn&&!!rival&&chainMode()&&chainIndex<chainPlayers-1);
    $('nextChainButton').textContent=hasName(chainIndex+1)?G.msg('passTo',{value:participantName(chainIndex+1)}):G.msg('passNext');
    $('revealButton').textContent=duelMode()?G.msg('duelReveal'):chainMode()?G.msg('compare'):t('revealBtn');
    $('chainHistory').hidden=!(reveal&&chainMode());
    $('winnerPanel').hidden=!(reveal&&duelMode());
    $('voteTitle').textContent=G.msg('vote');
    $('winnerOne').textContent='🎙️ '+participantName(0);
    $('winnerTwo').textContent='🎧 '+participantName(1);
    $('winnerTie').textContent=G.msg('voteTie');
    $('winnerResult').textContent=winner?(winner==='tie'?G.msg('winnerTie'):G.msg('resultNamed',{value:participantName(winner==='one'?0:1)})):'';
    $('revealPanel').hidden=!reveal;
    $('handoff').hidden=stage!=='handoff';
    const personIndex=activePerson();
    $('stageBadge').textContent=chainMode()&&!reveal
      ?(hasName(personIndex)?participantName(personIndex)+' · ':'👥 ')+(personIndex+1)+' / '+chainPlayers
      :!reveal&&hasName(personIndex)?'🎙️ '+participantName(personIndex)
      :t(hostTurn?'badgeHost':reveal?'badgeReveal':'badgeRival');
    $('stageTitle').textContent=!reveal&&hasName(personIndex)?G.msg('turnFor',{value:participantName(personIndex)}):t(hostTurn?'titleHost':reveal?'titleReveal':'titleRival');
    $('stageHint').textContent=chainMode()&&rivalTurn?G.msg('chainRivalHint'):duelMode()&&hostTurn?G.msg('duelStart'):duelMode()&&rivalTurn?G.msg('duelRival'):chainMode()&&reveal?G.msg('chainResult'):t(hostTurn?'hintHost':reveal?'hintReveal':'hintRival');
    $('gameSelectLabel').textContent=G.msg('select');
    $('gameDescription').textContent=G.description(modeId);
    // Help always explains the rules of the selected game, never another mode.
    const customKind=chainMode()?'chain':duelMode()?'duel':null;
    const help=$('helpPanel');
    help.querySelector('strong').textContent=G.msg('how');
    [...help.querySelectorAll('p')].forEach((paragraph,index)=>{
      paragraph.textContent=customKind?G.msg(customKind+'Help'+(index+1)):t('help'+(index+1));
    });
    $('gameSelect').value=modeId;
    $('gameSelect').disabled=recording||processing||pending;
    $('chainControls').hidden=!(chainMode()||(partyMode()&&mode().group==='groups'));
    $('chainPlayersLabel').textContent=G.msg('players');
    $('chainPlayers').disabled=partyMode()?false:!hostTurn||!!host;
    $('chainPlayers').value=String(chainPlayers);
    const two=$('chainPlayers').querySelector('option[value="2"]');if(two)two.disabled=chainMode();
    renderPlayerNames();
    $('promptBox').hidden=!(hostTurn||(duelMode()&&rivalTurn));
    $('promptLabel').textContent=G.msg('prompt');
    $('promptText').textContent=G.prompt(modeId,promptIndex);
    $('shufflePrompt').setAttribute('aria-label',G.msg('random'));
    $('shufflePrompt').disabled=recording||processing||pending||!!host||!!rival||!hostTurn;
    $('handoffTitle').textContent=hasName(chainMode()?chainIndex:1)?G.msg('passTo',{value:participantName(chainMode()?chainIndex:1)}):chainMode()?G.msg('step')+' '+(chainIndex+1)+' / '+chainPlayers:t('handoffTitle');
    $('handoff').querySelector('p').textContent=chainMode()?G.msg('chainRivalHint'):duelMode()?G.msg('duelRival'):t('handoffDesc');
    $('rivalReadyButton').textContent=hasName(chainMode()?chainIndex:1)?G.msg('readyFor',{value:participantName(chainMode()?chainIndex:1)}):chainMode()?(G.msg('step')+' '+(chainIndex+1)+' ➜'):t('rivalReady');
    renderHistory();
    const press=recording?t('stopRecord'):pending?t('startingMic'):processing?t('processing'):mode().limit?('⏱️ '+timeLimit()+'s'):t('recordHint');
    if(hostTurn){
      setTile('red',recording?'stop':'mic',t(recording?'stopRecord':host?'recordAgain':'recordSecret'),press);
      setTile('green','play',t(currentPlayback==='host-normal'?'stopOriginal':'checkVoice'),t(host?'checkVoiceDetail':'onlyAfterRecording'),currentPlayback==='host-normal');
      setTile('blue','next',t('passRival'),t(host?'passReady':'passFirst'));
    }else if(rivalTurn||stage==='handoff'){
      setTile('red',recording?'stop':'mic',t(recording?'stopRecord':rival?'retryImitate':'imitate'),press);
      const source=currentSource(),greenSide=duelMode()?'normal':'reverse',blueSide=duelMode()?'normal':'reverse';
      const greenActive=currentPlayback===(source===host?'host':'chain'+chainRecordings.indexOf(source))+'-'+greenSide;
      const blueActive=currentPlayback===(chainMode()?'chain'+chainIndex:'rival')+'-'+blueSide;
      setTile('green',duelMode()?'play':'reverse',t(greenActive?'stopAudio':'listenChallenge'),duelMode()?G.msg('duelListen'):t('reverseSecretDetail'),greenActive);
      setTile('blue',duelMode()?'play':'reverse',t(blueActive?'stopAudio':'myVoiceReverse'),duelMode()?G.msg('duelMine'):t(rival?'myVoiceDetail':'imitationFirst'),blueActive);
    }else{
      setTile('red','refresh',t('newRound'),t('letsPlay'));
      setTile('green','play',t(currentPlayback==='host-normal'?'stopOriginal':'playOriginal'),t('revealOriginal'),currentPlayback==='host-normal');
      const side=duelMode()?'normal':'reverse';
      const record=finalRecord();
      const active=currentPlayback===(chainMode()?'chain'+chainRecordings.indexOf(record):'rival')+'-'+side;
      setTile('blue',duelMode()?'play':'reverse',t(active?'stopImitation':'playRival'),duelMode()?G.msg('duelMine'):t('revealRival'),active);
    }
    $('filterToggle').checked=filterEnabled;
  }
  function onRed(){
    if(partyMode())return nextPartyCard();
    if(stage==='reveal')return resetRound();
    if(recording)return endRecording();
    if(stage==='host'||stage==='rival')return beginRecording();
  }
  function onGreen(){
    if(partyMode())return partyGreen();
    if(stage==='host')return playRecording(host,'normal');
    if(stage==='rival')return playRecording(currentSource(),duelMode()?'normal':'reverse');
    if(stage==='reveal')return playRecording(host,'normal');
  }
  function onBlue(){
    if(partyMode())return nextPartyTurn();
    if(stage==='host')return toHandoff();
    if(stage==='rival')return playRecording(rival,duelMode()?'normal':'reverse');
    if(stage==='reveal')return playRecording(finalRecord(),duelMode()?'normal':'reverse');
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
  $('nextChainButton').addEventListener('click',nextInChain);
  $('shufflePrompt').addEventListener('click',pickPrompt);
  $('gameSelect').addEventListener('change',e=>changeGame(e.target.value));
  $('chainPlayers').addEventListener('change',e=>{if(!partyMode()&&host){e.target.value=String(chainPlayers);say('namesLocked');return;}chainPlayers=Math.max(chainMode()?3:2,Math.min(6,Number(e.target.value)||4));partyIndex%=participantCount();render()});
  for(const button of document.querySelectorAll('[data-winner]'))button.addEventListener('click',()=>chooseWinner(button.dataset.winner));
  $('helpButton').addEventListener('click',()=>openPanel('helpPanel'));
  $('filterButton').addEventListener('click',()=>openPanel('filterPanel'));
  $('filterToggle').addEventListener('change',e=>{
    if(recording||processing||pending){e.target.checked=filterEnabled;say('settingsWait');return;}
    filterEnabled=e.target.checked;say(filterEnabled?'filterOn':'filterOff');
  });
  $('shareButton').addEventListener('click',()=>{
    const url='https://ayyoub1616.github.io/voicegame/?game='+encodeURIComponent(modeId);
    const message=G.msg('shareGame',{value:G.title(modeId)})+' '+t('shareMessage');
    try{
      if(navigator.share){const p=navigator.share({title:t('shareTitle'),text:message,url});p?.catch(err=>{if(err.name!=='AbortError')say('shareLink',{value:url});});}
      else if(navigator.clipboard?.writeText)navigator.clipboard.writeText(message+' '+url).then(()=>say('shareCopied')).catch(()=>say('shareLink',{value:url}));
      else say('shareLink',{value:url});
    }catch(_){say('shareLink',{value:url});}
  });
  window.addEventListener('pagehide',()=>{
    stopPartyTimer();
    clearTimer();stopPlaying();if(media?.state==='recording')try{media.stop()}catch(_){}
    disposeCapture();freeRecording(host);freeRecording(rival);
  });
  window.addEventListener('rewind:language',()=>{
    populateGames();render();
    if(stage==='reveal'){
      const actual=$('secretInput').value.trim(),guess=$('guessInput').value.trim();
      $('answerText').textContent=duelMode()?G.msg('duelReveal'):chainMode()?G.msg('chainResult'):(actual?t('secretWas',{value:actual}):t('answerByVoice'));
      $('guessText').textContent=guess?t('guessed',{value:guess}):'';
    }
    if(notice)notify(t(notice.key,notice.vars),notice.error);
  });
  populateGames();
  if(chainMode()||partyMode())$('playerNamesPanel').open=true;
  resetParty();
  render();
  if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')){
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  }
})();