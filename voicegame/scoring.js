/* VoiceGame — transparent, local, approximate rhythm/sound similarity. */
(() => {
  'use strict';
  const N=72, WINDOW=256, BANDS=[260,560,1200,2200];
  const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
  function fingerprint(buffer) {
    const a=buffer.getChannelData(0);
    const b=buffer.numberOfChannels>1?buffer.getChannelData(1):null;
    const stride=Math.max(1,Math.round(buffer.sampleRate/8000));
    const rate=buffer.sampleRate/stride, rows=[],coefs=BANDS.map(hz=>2*Math.cos(2*Math.PI*Math.min(hz,rate*.45)/rate));
    let peak=0,sumPeak=0;
    for(let f=0;f<N;f++){
      const start=Math.round(((f+.5)/N)*buffer.length-WINDOW*stride/2);
      const samples=new Float32Array(WINDOW);
      let power=0,cross=0,variation=0,last=0;
      for(let i=0;i<WINDOW;i++){
        const j=Math.max(0,Math.min(a.length-1,start+i*stride));
        const v=b?(a[j]+b[j])*.5:a[j];samples[i]=v;power+=v*v;
        if(i){variation+=Math.abs(v-last);if(v*last<0)cross++}last=v;
      }
      const rms=Math.sqrt(power/WINDOW);
      peak=Math.max(peak,rms);sumPeak+=rms;
      const bands=coefs.map(c=>{
        let p=0,q=0;
        for(let i=0;i<WINDOW;i++){const t=samples[i]+c*p-q;q=p;p=t}
        const energy=Math.max(0,p*p+q*q-c*p*q);
        return clamp(Math.log1p(energy/Math.max(power*WINDOW,1e-12)*25)/Math.log(6));
      });
      rows.push({rms,z:clamp(cross/WINDOW*5),variation:clamp(variation/(Math.sqrt(power*WINDOW)+.00001)),bands});
    }
    const rmsArray=rows.map(r=>r.rms).sort((x,y)=>x-y);
    const floor=rmsArray[Math.floor(N*.10)]||0;
    const ceiling=Math.max(.0001,rmsArray[Math.floor(N*.90)]-floor);
    for(let i=0;i<N;i++){
      rows[i].energy=clamp((rows[i].rms-floor)/ceiling);
      rows[i].onset=i?clamp(Math.abs(rows[i].energy-rows[i-1].energy)*2):0;
    }
    return {rows,duration:buffer.duration,peak,mean:sumPeak/N};
  }
  function compare(bufferA,bufferB){
    if(!bufferA||!bufferB)throw new Error('Se necesitan dos audios para calcular el resultado.');
    const a=fingerprint(bufferA),b=fingerprint(bufferB);
    if(a.peak<.008 || b.peak<.008 || a.mean<.0015 || b.mean<.0015){
      return {valid:false,reason:'No se distingue suficiente voz en una de las grabaciones. Prueba otra vez en un sitio más silencioso.'};
    }
    const penalty=.014;
    const grid=Array.from({length:N+1},()=>Array(N+1).fill(null));
    grid[0][0]={cost:0,rhythm:0,sound:0,steps:0};
    for(let i=1;i<=N;i++){
      for(let j=Math.max(1,i-11);j<=Math.min(N,i+11);j++){
        const x=a.rows[i-1],y=b.rows[j-1];
        const rhythm=.68*Math.abs(x.energy-y.energy)+.32*Math.abs(x.onset-y.onset);
        const sound=.27*Math.abs(x.z-y.z)+.18*Math.abs(x.variation-y.variation)+.55*x.bands.reduce((t,z,k)=>t+Math.abs(z-y.bands[k]),0)/BANDS.length;
        const cost=rhythm*.55+sound*.45;
        let best=null;
        for(const [pi,pj,extra] of [[i-1,j-1,0],[i-1,j,penalty],[i,j-1,penalty]]){
          const prev=grid[pi]?.[pj];
          if(!prev)continue;
          const candidate={cost:prev.cost+cost+extra,rhythm:prev.rhythm+rhythm,sound:prev.sound+sound,steps:prev.steps+1};
          if(!best || candidate.cost<best.cost)best=candidate;
        }
        grid[i][j]=best;
      }
    }
    const p=grid[N][N];if(!p)return{valid:false,reason:'No se pudieron alinear las grabaciones.'};
    const rhythm=clamp(1-(p.rhythm/p.steps)/.47);
    const sound=clamp(1-(p.sound/p.steps)/.47);
    const length=clamp(Math.exp(-1.12*Math.abs(Math.log(a.duration/b.duration))));
    let score=Math.round(100*(.46*rhythm+.29*sound+.25*length));
    if(Math.min(a.duration,b.duration)<.45)score=Math.min(score,70);
    return {valid:true,score:Math.round(clamp(score,0,100)),rhythm:Math.round(rhythm*100),sound:Math.round(sound*100),duration:Math.round(length*100)};
  }
  window.VoiceGameScoring={compare};
})();