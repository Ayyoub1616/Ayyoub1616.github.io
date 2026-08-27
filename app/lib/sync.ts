import { db } from './db';
import type { EntityType, PendingOperation } from './types';
import { apiUrl } from './api';

const tables = { reception:db.receptions, pallet:db.pallets, parcel:db.parcels, location:db.locations, movement:db.movements, barcodeRule:db.barcodeRules, anomaly:db.anomalies, audit:db.audits } as const;

export async function syncNow() {
  if (!navigator.onLine) return { synced:0, conflicts:[] as string[] };
  const pending = await db.operations.orderBy('createdAt').limit(200).toArray();
  if (pending.length) {
    const upload=pending.map((item)=>{const copy:Partial<PendingOperation>={...item};delete copy.attempts;delete copy.lastError;return copy;});
    const response=await fetch(apiUrl('/api/sync'),{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({operations:upload})});
    if(!response.ok)throw new Error(((await response.json()) as {error?:string}).error||'No se pudo sincronizar.');
    const result=await response.json() as {accepted:number;conflicts:string[]};
    await db.operations.bulkDelete(pending.filter((op)=>!result.conflicts.includes(op.entityId)).map((op)=>op.id));
  }
  const remote=await fetch(apiUrl('/api/sync'),{credentials:'include'});
  if(!remote.ok)throw new Error(((await remote.json()) as {error?:string}).error||'No se pudieron traer los cambios.');
  const data=await remote.json() as {entities:Array<{id:string;entityType:EntityType;data:Record<string,unknown>;deletedAt:string|null}>};
  await db.transaction('rw',[db.receptions,db.pallets,db.parcels,db.locations,db.movements,db.barcodeRules,db.anomalies,db.audits],async()=>{
    for(const entity of data.entities){const table=tables[entity.entityType] as typeof db.receptions;if(entity.deletedAt)await table.delete(entity.id);else await table.put(entity.data as never);}
  });
  return { synced:pending.length, conflicts:[] as string[] };
}

export async function uploadCloudBackup(){
  await syncNow();
  const snapshot={receptions:await db.receptions.toArray(),pallets:await db.pallets.toArray(),parcels:await db.parcels.toArray(),locations:await db.locations.toArray(),movements:await db.movements.toArray()};
  const response=await fetch(apiUrl('/api/backup'),{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(snapshot)});
  const body=await response.json() as {error?:string;createdAt?:string};if(!response.ok)throw new Error(body.error||'No se pudo subir la copia.');return body;
}

export async function downloadCloudBackup(){
  const response=await fetch(apiUrl('/api/backup'),{credentials:'include'});const body=await response.json() as {error?:string;snapshot?:{receptions:never[];pallets:never[];parcels:never[];locations:never[];movements:never[]};createdAt?:string;operator?:string};if(!response.ok||!body.snapshot)throw new Error(body.error||'No se pudo bajar la copia.');
  const snapshot=body.snapshot;await db.transaction('rw',[db.receptions,db.pallets,db.parcels,db.locations,db.movements],async()=>{await Promise.all([db.receptions.bulkPut(snapshot.receptions),db.pallets.bulkPut(snapshot.pallets),db.parcels.bulkPut(snapshot.parcels),db.locations.bulkPut(snapshot.locations),db.movements.bulkPut(snapshot.movements)])});return {createdAt:body.createdAt,operator:body.operator};
}

export async function markSyncFailure(operations:PendingOperation[],error:string){
  await db.operations.bulkPut(operations.map((op)=>({...op,attempts:op.attempts+1,lastError:error})));
}

export function subscribeRealtime(onChange:()=>void){let cursor=sessionStorage.getItem('palletflow-event-sequence')||'0';const source=new EventSource(`${apiUrl('/api/events')}?since=${encodeURIComponent(cursor)}`,{withCredentials:true});source.addEventListener('change',(event)=>{const message=event as MessageEvent<string>;try{const data=JSON.parse(message.data) as {sequence:number};cursor=String(data.sequence);sessionStorage.setItem('palletflow-event-sequence',cursor)}catch{}onChange()});return()=>source.close()}
