import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {corsJson,corsOptions} from '../_lib/cors';
import {requireManager,verifyPassword} from '../_lib/access';
import {ensureSchema,getD1} from '../../../db/runtime';
import type {EntityRow} from '../../../db/schema';

export const dynamic='force-dynamic';
export const OPTIONS=corsOptions;

type StoredEntity=EntityRow&{data:Record<string,unknown>};
type TrashRow={id:string;idempotency_key:string;target_type:'reception'|'pallet';target_id:string;identifier:string;reason:string;snapshot_key:string;snapshot_json:string;impact_json:string;actor_user_id:string;deleted_at:string;restored_at:string|null};
const destructiveSchema=z.object({targetType:z.enum(['reception','pallet']),targetId:z.string().min(1).max(100),identifier:z.string().trim().min(1).max(200),reason:z.string().trim().min(8).max(500),password:z.string().min(8).max(128),idempotencyKey:z.string().uuid()});
const restoreSchema=z.object({trashId:z.string().uuid(),identifier:z.string().trim().min(1).max(200),reason:z.string().trim().min(8).max(500),password:z.string().min(8).max(128),idempotencyKey:z.string().uuid(),resolution:z.enum(['conservar','desubicar']).default('conservar')});
const parse=(row:EntityRow):StoredEntity=>({...row,data:JSON.parse(row.data_json) as Record<string,unknown>});
const entityIdentifier=(row:StoredEntity)=>String(row.data[row.entity_type==='reception'?'reference':'code']??'').trim();

async function adminWithPassword(password:string){const admin=await requireManager();if(!admin)return null;const row=await getD1().prepare('SELECT password_hash,password_salt FROM app_users WHERE id=? AND status=?').bind(admin.id,'active').first<{password_hash:string;password_salt:string}>();return row&&await verifyPassword(password,row.password_salt,row.password_hash)?admin:null}

async function scope(targetType:'reception'|'pallet',targetId:string,includeDeleted=false){
  const rows=await getD1().prepare(`SELECT * FROM entities ${includeDeleted?'':'WHERE deleted_at IS NULL'} ORDER BY updated_at`).all<EntityRow>();
  const all=rows.results.map(parse),target=all.find(row=>row.id===targetId&&row.entity_type===targetType);
  if(!target)return null;
  const pallets=targetType==='reception'?all.filter(row=>row.entity_type==='pallet'&&row.data.receptionId===targetId):[target];
  const palletIds=new Set(pallets.map(row=>row.id));
  const parcels=all.filter(row=>row.entity_type==='parcel'&&palletIds.has(String(row.data.palletId)));
  const anomalies=all.filter(row=>row.entity_type==='anomaly'&&(row.data.receptionId===targetId||palletIds.has(String(row.data.palletId))));
  const movements=all.filter(row=>row.entity_type==='movement'&&palletIds.has(String(row.data.palletId)));
  const operational=[target,...pallets.filter(row=>row.id!==target.id),...parcels,...anomalies];
  const activeTasks=pallets.filter(row=>['pendiente','en_curso'].includes(String(row.data.taskStatus??''))||Boolean(row.data.reservationId)||Number(row.data.reservedUnits||0)>0);
  const impact={targetType,targetId,identifier:entityIdentifier(target),pallets:pallets.length,parcels:parcels.length,units:pallets.reduce((sum,row)=>sum+Number(row.data.units||0),0),occupiedLocations:new Set(pallets.map(row=>row.data.locationId).filter(Boolean)).size,reservations:activeTasks.filter(row=>Boolean(row.data.reservationId)||Number(row.data.reservedUnits||0)>0).length,activeTasks:activeTasks.length,anomalies:anomalies.length,movements:movements.length};
  return{target,pallets,parcels,anomalies,movements,operational,activeTasks,impact};
}

export async function GET(request:Request){
  if(!await requireManager())return corsJson({error:'Solo el administrador puede consultar la papelera.'},{status:403});
  await ensureSchema();const url=new URL(request.url),targetType=url.searchParams.get('targetType'),targetId=url.searchParams.get('targetId');
  if((targetType==='reception'||targetType==='pallet')&&targetId){const found=await scope(targetType,targetId);return found?corsJson({impact:found.impact}):corsJson({error:'Registro no encontrado.'},{status:404})}
  const rows=await getD1().prepare('SELECT id,target_type,target_id,identifier,reason,impact_json,deleted_at,restored_at FROM trash_actions ORDER BY deleted_at DESC LIMIT 250').all<Omit<TrashRow,'idempotency_key'|'snapshot_key'|'snapshot_json'|'actor_user_id'>>();
  return corsJson({items:rows.results.map(row=>({...row,impact:JSON.parse(row.impact_json)}))});
}

export async function POST(request:Request){
  await ensureSchema();const parsed=destructiveSchema.safeParse(await request.json());if(!parsed.success)return corsJson({error:'Faltan la confirmación exacta, el motivo, la contraseña o la clave de seguridad.'},{status:400});
  const admin=await adminWithPassword(parsed.data.password);if(!admin)return corsJson({error:'Solo el administrador reautenticado puede mover registros a la papelera.'},{status:403});
  const existing=await getD1().prepare('SELECT id,impact_json,deleted_at FROM trash_actions WHERE idempotency_key=?').bind(parsed.data.idempotencyKey).first<{id:string;impact_json:string;deleted_at:string}>();if(existing)return corsJson({ok:true,id:existing.id,impact:JSON.parse(existing.impact_json),deletedAt:existing.deleted_at,replayed:true});
  const found=await scope(parsed.data.targetType,parsed.data.targetId);if(!found)return corsJson({error:'El registro ya no está activo o no existe.'},{status:404});
  if(entityIdentifier(found.target)!==parsed.data.identifier)return corsJson({error:'El identificador escrito no coincide exactamente.'},{status:409});
  if(found.activeTasks.length)return corsJson({error:'Hay reservas o tareas activas. Cancélalas o reasígnalas antes.',impact:found.impact},{status:409});
  const now=new Date().toISOString(),trashId=crypto.randomUUID(),snapshot={createdAt:now,targetType:parsed.data.targetType,targetId:parsed.data.targetId,entities:found.operational.map(({data,...row})=>({...row,data}))},snapshotJson=JSON.stringify(snapshot),snapshotKey=`trash/${now.slice(0,10)}/${trashId}.json`;
  await env.FILES.put(snapshotKey,snapshotJson,{httpMetadata:{contentType:'application/json'}});
  const db=getD1(),statements=[db.prepare('INSERT INTO trash_actions (id,idempotency_key,target_type,target_id,identifier,reason,snapshot_key,snapshot_json,impact_json,actor_user_id,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(trashId,parsed.data.idempotencyKey,parsed.data.targetType,parsed.data.targetId,parsed.data.identifier,parsed.data.reason,snapshotKey,snapshotJson,JSON.stringify(found.impact),admin.id,now)];
  for(const row of found.operational){const operationId=crypto.randomUUID();statements.push(db.prepare('UPDATE entities SET version=version+1,updated_at=?,deleted_at=? WHERE id=? AND deleted_at IS NULL').bind(now,now,row.id),db.prepare('INSERT INTO operations (id,entity_id,action,payload_json,actor_user_id,device_id,created_at) VALUES (?,?,?,?,?,?,?)').bind(operationId,row.id,'delete',row.data_json,admin.id,'server-trash-v9',now),db.prepare('INSERT INTO sync_events (operation_id,entity_id,entity_type,created_at) VALUES (?,?,?,?)').bind(operationId,row.id,row.entity_type,now));if(row.entity_type==='pallet')statements.push(db.prepare('DELETE FROM location_claims WHERE pallet_id=?').bind(row.id))}
  statements.push(db.prepare('INSERT INTO security_audit (id,user_id,action,target_type,target_id,correlation_id,detail_json,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),admin.id,'trash.soft_delete',parsed.data.targetType,parsed.data.targetId,trashId,JSON.stringify({reason:parsed.data.reason,impact:found.impact}),now));
  try{await db.batch(statements)}catch(error){await env.FILES.delete(snapshotKey);throw error}
  return corsJson({ok:true,id:trashId,impact:found.impact,deletedAt:now},{status:201});
}

export async function PATCH(request:Request){
  await ensureSchema();const parsed=restoreSchema.safeParse(await request.json());if(!parsed.success)return corsJson({error:'Datos de restauración incompletos.'},{status:400});
  const admin=await adminWithPassword(parsed.data.password);if(!admin)return corsJson({error:'Solo el administrador reautenticado puede restaurar.'},{status:403});
  const db=getD1(),row=await db.prepare('SELECT * FROM trash_actions WHERE id=?').bind(parsed.data.trashId).first<TrashRow>();if(!row)return corsJson({error:'Elemento de papelera no encontrado.'},{status:404});if(row.identifier!==parsed.data.identifier)return corsJson({error:'El identificador escrito no coincide exactamente.'},{status:409});if(row.restored_at)return corsJson({ok:true,restoredAt:row.restored_at,replayed:true});
  const duplicate=await db.prepare('SELECT restored_at FROM trash_actions WHERE restore_idempotency_key=?').bind(parsed.data.idempotencyKey).first<{restored_at:string}>();if(duplicate)return corsJson({ok:true,restoredAt:duplicate.restored_at,replayed:true});
  const snapshot=JSON.parse(row.snapshot_json) as {entities:Array<StoredEntity>},pallets=snapshot.entities.filter(item=>item.entity_type==='pallet'),conflicts:Record<string,string>[]=[];
  for(const pallet of pallets){const qr=String(pallet.data.normalizedCode||pallet.data.code||'').toUpperCase(),qrOwner=qr?await db.prepare("SELECT e.id FROM entities e WHERE e.entity_type='pallet' AND e.deleted_at IS NULL AND e.id<>? AND UPPER(COALESCE(json_extract(e.data_json,'$.normalizedCode'),json_extract(e.data_json,'$.code')))=?").bind(pallet.id,qr).first<{id:string}>():null;if(qrOwner)conflicts.push({type:'qr',value:qr});const locationId=String(pallet.data.locationId||''),occupant=locationId?await db.prepare('SELECT pallet_id FROM location_claims WHERE location_id=? AND pallet_id<>?').bind(locationId,pallet.id).first<{pallet_id:string}>():null;if(occupant)conflicts.push({type:'ubicacion',value:locationId})}
  if(conflicts.length&&parsed.data.resolution!=='desubicar')return corsJson({error:'La restauración tiene conflictos. Elige restaurar sin ubicación o resuélvelos antes.',conflicts},{status:409});
  const now=new Date().toISOString(),statements=[];
  for(const item of snapshot.entities){const current=await db.prepare('SELECT version FROM entities WHERE id=?').bind(item.id).first<{version:number}>();if(!current)continue;const data:Record<string,unknown>={...item.data,updatedAt:now,version:Number(current.version)+1};if(item.entity_type==='pallet'&&parsed.data.resolution==='desubicar'){delete data.locationId;delete data.locatedAt;data.status='en_suelo'}const operationId=crypto.randomUUID();statements.push(db.prepare('UPDATE entities SET data_json=?,version=?,updated_at=?,deleted_at=NULL WHERE id=?').bind(JSON.stringify(data),data.version,now,item.id),db.prepare('INSERT INTO operations (id,entity_id,action,payload_json,actor_user_id,device_id,created_at) VALUES (?,?,?,?,?,?,?)').bind(operationId,item.id,'restore',JSON.stringify(data),admin.id,'server-trash-v9',now),db.prepare('INSERT INTO sync_events (operation_id,entity_id,entity_type,created_at) VALUES (?,?,?,?)').bind(operationId,item.id,item.entity_type,now));if(item.entity_type==='pallet'&&parsed.data.resolution==='conservar'&&data.locationId)statements.push(db.prepare('INSERT INTO location_claims (location_id,pallet_id) VALUES (?,?)').bind(data.locationId,item.id))}
  statements.push(db.prepare('UPDATE trash_actions SET restored_at=?,restored_by=?,restore_reason=?,restore_idempotency_key=? WHERE id=? AND restored_at IS NULL').bind(now,admin.id,parsed.data.reason,parsed.data.idempotencyKey,row.id),db.prepare('INSERT INTO security_audit (id,user_id,action,target_type,target_id,correlation_id,detail_json,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),admin.id,'trash.restore',row.target_type,row.target_id,row.id,JSON.stringify({reason:parsed.data.reason,resolution:parsed.data.resolution,conflicts}),now));
  try{await db.batch(statements)}catch{return corsJson({error:'La restauración entró en conflicto con cambios recientes. Actualiza y revisa de nuevo.'},{status:409})}
  return corsJson({ok:true,restoredAt:now,resolution:parsed.data.resolution});
}
