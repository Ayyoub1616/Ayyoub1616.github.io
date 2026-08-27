import { z } from 'zod';
import { ensureSchema, getD1 } from '../../../db/runtime';
import type { EntityRow } from '../../../db/schema';
import { currentProfile } from '../_lib/access';
import { canWriteEntity } from '../_lib/policy';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';
const cors={'access-control-allow-origin':'https://ayyoub1616.github.io','access-control-allow-credentials':'true','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization'};
const json=(data:unknown,init?:ResponseInit)=>Response.json(data,{...init,headers:{...cors,...init?.headers}});
export async function OPTIONS(){return new Response(null,{status:204,headers:cors})}

const operationSchema = z.object({
  id: z.string().uuid(), entityId: z.string().min(1).max(100), entityType: z.enum(['reception','pallet','parcel','location','movement','barcodeRule','anomaly','audit']),
  action: z.enum(['upsert','delete']), data: z.record(z.string(), z.unknown()), version: z.number().int().positive(),
  deviceId: z.string().min(8).max(100), createdAt: z.iso.datetime(),
});

export async function GET() {
  if(!await currentProfile())return json({error:'Debes identificarte para sincronizar.'},{status:401});
  await ensureSchema();
  const rows = await getD1().prepare('SELECT * FROM entities ORDER BY updated_at ASC').all<EntityRow>();
  return json({ entities: rows.results.map((row) => ({ id: row.id, entityType: row.entity_type, data: JSON.parse(row.data_json), version: row.version, updatedAt: row.updated_at, deletedAt: row.deleted_at })) });
}

export async function POST(request: Request) {
  const profile=await currentProfile();if(!profile)return json({error:'Debes identificarte para sincronizar.'},{status:401});
  const operator=profile.display_name;
  const body = z.object({ operations: z.array(operationSchema).max(200) }).safeParse(await request.json());
  if (!body.success) return json({ error: 'Lote de sincronización no válido.' }, { status: 400 });
  await ensureSchema();
  const db = getD1();
  for (const op of body.data.operations) {
    if(!canWriteEntity(profile.role,op.entityType,op.action))return json({error:'Tu rol no permite esta operación.'},{status:403});
  }
  const acceptedOperations:typeof body.data.operations=[],conflicts:string[]=[];
  for(const op of body.data.operations){
    const repeated=await db.prepare('SELECT id FROM operations WHERE id=?').bind(op.id).first();if(repeated)continue;
    const current=await db.prepare('SELECT version,deleted_at FROM entities WHERE id=?').bind(op.entityId).first<{version:number;deleted_at:string|null}>();
    // Un tombstone confirmado en servidor nunca puede ser resucitado por una
    // cola antigua. Restaurar sólo es posible mediante /api/trash.
    if(current?.deleted_at&&op.action==='upsert'){conflicts.push(op.entityId);continue}
    if(current&&op.version<=Number(current.version)){conflicts.push(op.entityId);continue}
    acceptedOperations.push(op);
  }
  const statements=acceptedOperations.flatMap(op=>{
    const claims=[];const data=op.data as {code?:string;normalizedCode?:string;palletId?:string;locationId?:string};
    if(op.entityType==='pallet'&&op.action==='upsert'){claims.push(db.prepare('DELETE FROM pallet_qr_claims WHERE pallet_id=?').bind(op.entityId));claims.push(db.prepare('INSERT INTO pallet_qr_claims (qr,pallet_id) VALUES (?,?)').bind((data.normalizedCode||data.code||'').toUpperCase(),op.entityId));claims.push(db.prepare('DELETE FROM location_claims WHERE pallet_id=?').bind(op.entityId));if(data.locationId)claims.push(db.prepare('INSERT INTO location_claims (location_id,pallet_id) VALUES (?,?)').bind(data.locationId,op.entityId))}
    if(op.entityType==='parcel'&&op.action==='upsert'&&data.palletId){claims.push(db.prepare('DELETE FROM parcel_claims WHERE parcel_id=?').bind(op.entityId));claims.push(db.prepare('INSERT INTO parcel_claims (pallet_id,code,parcel_id) VALUES (?,?,?)').bind(data.palletId,(data.normalizedCode||data.code||'').toUpperCase(),op.entityId))}
    return [
      db.prepare(`INSERT INTO entities (id,entity_type,data_json,version,updated_at,deleted_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET entity_type=excluded.entity_type,data_json=excluded.data_json,version=excluded.version,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at
        WHERE excluded.version > entities.version`)
        .bind(op.entityId,op.entityType,JSON.stringify(op.data),op.version,op.createdAt,op.action === 'delete' ? op.createdAt : null),
      db.prepare('INSERT OR IGNORE INTO operations (id,entity_id,action,payload_json,actor_user_id,device_id,created_at) VALUES (?,?,?,?,?,?,?)')
        .bind(op.id,op.entityId,op.action,JSON.stringify(op.data),operator,op.deviceId,op.createdAt),
      db.prepare('INSERT OR IGNORE INTO sync_events (operation_id,entity_id,entity_type,created_at) VALUES (?,?,?,?)').bind(op.id,op.entityId,op.entityType,op.createdAt),
      ...claims];
  });
  try{if(statements.length)await db.batch(statements)}catch{return json({error:'Conflicto: el QR, bulto o hueco ya ha sido confirmado por otro dispositivo.'},{status:409})}
  const webhook=(env as unknown as Record<string,string|undefined>).PALLETFLOW_WEBHOOK_URL,secret=(env as unknown as Record<string,string|undefined>).PALLETFLOW_WEBHOOK_SECRET;for(const op of acceptedOperations){if(webhook&&op.entityType==='reception'&&(op.data as {status?:string}).status==='cerrada')await fetch(webhook,{method:'POST',headers:{'content-type':'application/json','x-palletflow-signature':secret||''},body:JSON.stringify({event:'reception.closed',reception:op.data,occurredAt:op.createdAt})})}
  return json({ accepted: acceptedOperations.length, conflicts, discarded:conflicts });
}
