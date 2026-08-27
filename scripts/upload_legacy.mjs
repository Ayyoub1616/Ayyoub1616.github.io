#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const [backupPath, baseUrl='https://palletflow-almacen.truthisoutchannel.chatgpt.site'] = process.argv.slice(2);
const pin=process.env.PALLETFLOW_ADMIN_PIN;
if(!backupPath||!pin)throw new Error('Uso: PALLETFLOW_ADMIN_PIN=... node scripts/upload_legacy.mjs copia.json [url]');

const login=await fetch(`${baseUrl}/api/session`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Ayyoub',pin})});
if(!login.ok)throw new Error(`Acceso rechazado (${login.status}).`);
const cookie=login.headers.get('set-cookie')?.split(';',1)[0];
if(!cookie)throw new Error('El servidor no devolvió una sesión segura.');

const backup=JSON.parse(await readFile(backupPath,'utf8'));
const groups=[['reception',backup.receptions],['pallet',backup.pallets],['parcel',backup.parcels],['location',backup.locations],['movement',backup.movements]];
const uuid=(value)=>{const bytes=Buffer.from(createHash('sha256').update(value).digest().subarray(0,16));bytes[6]=(bytes[6]&0x0f)|0x50;bytes[8]=(bytes[8]&0x3f)|0x80;return `${bytes.toString('hex',0,4)}-${bytes.toString('hex',4,6)}-${bytes.toString('hex',6,8)}-${bytes.toString('hex',8,10)}-${bytes.toString('hex',10,16)}`};
const operations=groups.flatMap(([entityType,items])=>items.map((data)=>({id:uuid(`legacy-operation:${entityType}:${data.id}`),entityId:data.id,entityType,action:'upsert',data,version:data.version||1,deviceId:'legacy-import-20260826',createdAt:data.updatedAt||backup.createdAt})));

let accepted=0,conflicts=0;
for(let offset=0;offset<operations.length;offset+=200){const response=await fetch(`${baseUrl}/api/sync`,{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({operations:operations.slice(offset,offset+200)})});const body=await response.json();if(!response.ok)throw new Error(body.error||`Falló el lote ${offset/200+1}.`);accepted+=body.accepted||0;conflicts+=(body.conflicts||[]).length;process.stdout.write(`\r${Math.min(offset+200,operations.length)}/${operations.length}`)}
console.log(`\nImportación terminada: ${accepted} aceptados, ${conflicts} ya existentes.`);
