import { z } from 'zod';
import { ensureSchema,getD1 } from '../../../db/runtime';
import { currentProfile, requireManager } from '../_lib/access';
import { env } from 'cloudflare:workers';

export const dynamic='force-dynamic';
const entity=z.record(z.string(),z.unknown());
const snapshotSchema=z.object({receptions:z.array(entity).max(2000),pallets:z.array(entity).max(10000),parcels:z.array(entity).max(100000),locations:z.array(entity).max(10000),movements:z.array(entity).max(100000)});
const cors={'access-control-allow-origin':'https://ayyoub1616.github.io','access-control-allow-credentials':'true','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'};
const json=(data:unknown,init?:ResponseInit)=>Response.json(data,{...init,headers:{...cors,...init?.headers}});
export async function OPTIONS(){return new Response(null,{status:204,headers:cors})}

export async function POST(request:Request){
  const profile=await requireManager();if(!profile)return json({error:'Solo Ayyoub puede sustituir la copia completa de seguridad.'},{status:403});
  if(Number(request.headers.get('content-length')||0)>10_000_000)return json({error:'La copia supera 10 MB.'},{status:413});
  const parsed=snapshotSchema.safeParse(await request.json());if(!parsed.success)return json({error:'La copia no tiene un formato válido.'},{status:400});
  const operator=profile.display_name;const createdAt=new Date().toISOString(),id=crypto.randomUUID(),payload=JSON.stringify(parsed.data),key=`backups/${createdAt.slice(0,10)}/${id}.json`,digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload)),checksum=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  await env.FILES.put(key,payload,{httpMetadata:{contentType:'application/json'},customMetadata:{checksum}});await ensureSchema();await getD1().prepare('INSERT INTO cloud_backups (id,operator_name,data_json,created_at) VALUES (?,?,?,?)').bind(id,operator,JSON.stringify({r2Key:key,checksum}),createdAt).run();
  return json({ok:true,createdAt,checksum});
}

export async function GET(){
  if(!await currentProfile())return json({error:'Debes identificarte para usar la nube.'},{status:401});
  await ensureSchema();const row=await getD1().prepare('SELECT data_json,operator_name,created_at FROM cloud_backups ORDER BY created_at DESC LIMIT 1').first<{data_json:string;operator_name:string;created_at:string}>();
  if(!row)return json({error:'Todavía no hay copias en la nube.'},{status:404});const stored=JSON.parse(row.data_json) as {r2Key?:string};if(stored.r2Key){const object=await env.FILES.get(stored.r2Key);if(!object)return json({error:'La copia está registrada pero el archivo no existe.'},{status:500});return json({snapshot:JSON.parse(await object.text()),operator:row.operator_name,createdAt:row.created_at})}return json({snapshot:stored,operator:row.operator_name,createdAt:row.created_at});
}
