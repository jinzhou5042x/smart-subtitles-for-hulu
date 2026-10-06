import { readFile } from 'node:fs/promises';
import { loadConfig } from '../service/config.mjs';
const config=await loadConfig();
const saved=JSON.parse(await readFile('data/episodes/e75a261cbcb4f35c6344b9d8822a4ffa9bc3021fb007ea2534f7d0df29c07b95.json','utf8'));
const request={provider:'local',target:'zh-CN',session:'progress-check',client:'progress-check',epoch:String(Date.now()),cues:saved.sourceCues.slice(0,40)};
async function api(route,body) {
  const response=await fetch(`http://127.0.0.1:${config.port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${config.pairingToken}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json(); if(!response.ok)throw new Error(data.error); return data;
}
const started=Date.now(); let result=await api('/episodes',request), firstPartial=null;
try {
  while(['queued','running'].includes(result.status)) {
    if(result.completedCues>0 && result.completedCues<40 && firstPartial===null) {
      firstPartial=(Date.now()-started)/1000;
      if(!result.segments.length || result.cached || result.progress?.partialSegments)throw new Error('Invalid partial delivery');
      console.log(JSON.stringify({firstPartialSeconds:firstPartial,available:result.completedCues,status:result.status}));
    }
    if(Date.now()-started>120000)throw new Error('Progress check timeout');
    await new Promise(r=>setTimeout(r,250)); result=await api(`/episodes/${result.id}`);
  }
  if(result.status!=='done'||result.completedCues!==40||firstPartial===null)throw new Error(result.error||'No partial result observed');
  console.log(JSON.stringify({totalSeconds:(Date.now()-started)/1000,firstPartialSeconds:firstPartial,status:result.status,completed:result.completedCues}));
} finally { await api('/cancel',{client:request.client}); }
