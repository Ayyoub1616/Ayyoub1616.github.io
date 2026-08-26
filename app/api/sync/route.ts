import { z } from 'zod';
import { ensureSchema, getD1 } from '../../../db/runtime';
import type { EntityRow } from '../../../db/schema';
import { currentProfile } from '../_lib/access';

export const dynamic = 'force-dynamic';
const cors={'access-control-allow-origin':'https://ayyoub1616.github.io','access-control-allow-credentials':'true','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'};
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
    if(profile.role!=='manager'&&op.action==='delete')return json({error:'Un operario no puede borrar información.'},{status:403});
    if(profile.role!=='manager'&&op.entityType==='reception'&&op.version>1)return json({error:'Solo Ayyoub puede modificar una recepción existente.'},{status:403});
  }
  const statements=body.data.operations.flatMap(op=>[
      db.prepare(`INSERT INTO entities (id,entity_type,data_json,version,updated_at,deleted_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET entity_type=excluded.entity_type,data_json=excluded.data_json,version=excluded.version,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at
        WHERE excluded.version > entities.version`)
        .bind(op.entityId,op.entityType,JSON.stringify(op.data),op.version,op.createdAt,op.action === 'delete' ? op.createdAt : null),
      db.prepare('INSERT OR IGNORE INTO operations (id,entity_id,action,payload_json,actor_user_id,device_id,created_at) VALUES (?,?,?,?,?,?,?)')
        .bind(op.id,op.entityId,op.action,JSON.stringify(op.data),operator,op.deviceId,op.createdAt),
  ]);
  if(statements.length)await db.batch(statements);
  return json({ accepted: body.data.operations.length, conflicts:[] });
}
