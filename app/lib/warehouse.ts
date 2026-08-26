import { db, deviceId } from './db';
import type { Anomaly, BaseEntity, EntityType, Location, Movement, Pallet, Parcel, PendingOperation, Reception } from './types';
import { receptionInputSchema, scanInputSchema } from './validation';

const iso = () => new Date().toISOString();
const recentReads=new Map<string,number>();
const record = (value: object) => value as unknown as Record<string, unknown>;

function operation(entityType:EntityType, entity:BaseEntity):PendingOperation {
  return { id:crypto.randomUUID(), entityId:entity.id, entityType, action:'upsert', data:record(entity), version:entity.version, deviceId:deviceId(), createdAt:iso(), attempts:0 };
}

export async function createReception(input:{reference:string;vehicle?:string;receivedAt:string;expectedPallets:number;notes:string},operator:string) {
  const clean = receptionInputSchema.parse(input);
  const now = iso();
  const reception:Reception = { id:crypto.randomUUID(),createdAt:now,updatedAt:now,deletedAt:null,version:1,...clean,status:'descarga' };
  const pallets:Pallet[] = Array.from({length:clean.expectedPallets},(_,index)=>({
    id:crypto.randomUUID(),createdAt:now,updatedAt:now,deletedAt:null,version:1,code:`PAL-${clean.reference}-${String(index+1).padStart(3,'0')}`,
    number:index+1,receptionId:reception.id,status:'pendiente',article:'',parcels:0,units:0,notes:'',operator,
  }));
  const movementRows:Movement[] = pallets.map((pallet)=>({ id:crypto.randomUUID(),createdAt:now,updatedAt:now,deletedAt:null,version:1,palletId:pallet.id,type:'creacion',reason:'Alta en recepción',operator,deviceId:deviceId() }));
  await db.transaction('rw',[db.receptions,db.pallets,db.movements,db.operations],async()=>{
    await db.receptions.add(reception); await db.pallets.bulkAdd(pallets); await db.movements.bulkAdd(movementRows);
    await db.operations.bulkAdd([operation('reception',reception),...pallets.map((item)=>operation('pallet',item)),...movementRows.map((item)=>operation('movement',item))]);
  });
  return reception;
}

export async function updateReception(input:{id:string;reference:string;vehicle?:string;receivedAt:string;expectedPallets:number;notes:string},operator:string) {
  const current=await db.receptions.get(input.id);if(!current||current.deletedAt)throw new Error('Recepción no encontrada.');
  if(current.status==='cerrada')throw new Error('Desbloquea la recepción antes de editarla.');
  const clean=receptionInputSchema.parse(input);const all=await db.pallets.where('receptionId').equals(input.id).toArray();const active=all.filter(p=>!p.deletedAt).sort((a,b)=>a.number-b.number);
  const now=iso();const additions:Pallet[]=[];const restorations:Pallet[]=[];const removals:Pallet[]=[];
  if(clean.expectedPallets>active.length){
    const reusable=all.filter(p=>p.deletedAt&&!p.parcels&&!p.locationId&&!p.scanClosedAt&&!p.taskStatus).sort((a,b)=>a.number-b.number);
    while(active.length+restorations.length<clean.expectedPallets&&reusable.length){const pallet=reusable.shift()!;restorations.push({...pallet,deletedAt:null,updatedAt:now,version:pallet.version+1,operator})}
    const usedNumbers=new Set(all.map(p=>p.number));let number=Math.max(0,...usedNumbers)+1;
    while(active.length+restorations.length+additions.length<clean.expectedPallets){while(usedNumbers.has(number))number++;usedNumbers.add(number);additions.push({id:crypto.randomUUID(),createdAt:now,updatedAt:now,deletedAt:null,version:1,code:`PAL-${clean.reference}-${String(number).padStart(3,'0')}`,number,receptionId:current.id,status:'pendiente',article:'',parcels:0,units:0,notes:'',operator});number++}
  }else if(clean.expectedPallets<active.length){
    const candidates=[...active].sort((a,b)=>b.number-a.number).slice(0,active.length-clean.expectedPallets);
    if(candidates.some(p=>p.parcels>0||p.locationId||p.scanClosedAt||p.taskStatus))throw new Error('No se pueden quitar palés que ya tengan cajas, ubicación, cierre o tareas. Reduce primero solo los últimos palés vacíos.');
    removals.push(...candidates.map(p=>({...p,deletedAt:now,updatedAt:now,version:p.version+1})));
  }
  const updated:Reception={...current,...clean,updatedAt:now,version:current.version+1};
  const movements:Movement[]=additions.map(p=>({id:crypto.randomUUID(),createdAt:now,updatedAt:now,deletedAt:null,version:1,palletId:p.id,type:'creacion',reason:'Palé añadido al editar la recepción',operator,deviceId:deviceId()}));
  await db.transaction('rw',[db.receptions,db.pallets,db.movements,db.operations],async()=>{
    await db.receptions.put(updated);if(additions.length)await db.pallets.bulkAdd(additions);if(restorations.length||removals.length)await db.pallets.bulkPut([...restorations,...removals]);if(movements.length)await db.movements.bulkAdd(movements);
    await db.operations.bulkAdd([operation('reception',updated),...additions.map(p=>operation('pallet',p)),...restorations.map(p=>operation('pallet',p)),...removals.map(p=>operation('pallet',p)),...movements.map(m=>operation('movement',m))]);
  });return updated;
}

export async function scanParcel(input:{palletId:string;code:string;originalCode?:string;ruleVersion?:number;article:string;mocacota?:string;model?:string;quality?:string;color?:string;size?:string;units:number;operator:string;acceptAnomaly?:boolean}) {
  const clean = scanInputSchema.parse(input);
  const pallet = await db.pallets.get(input.palletId);
  if (!pallet) throw new Error('No se encuentra el palé seleccionado.');
  if (pallet.status === 'extraido') throw new Error('El palé ya está extraído y no admite lecturas.');
  if (pallet.scanClosedAt) throw new Error('El palé está cerrado. Sólo un manager puede reabrirlo.');
  const duplicate = await db.parcels.where('code').equalsIgnoreCase(clean.code).filter(item=>item.palletId===pallet.id&&!item.voidedAt&&!item.deletedAt).first();
  if (duplicate) throw new Error(`El bulto ${clean.code} ya está registrado en este palé.`);
  const readKey=`${input.palletId}:${clean.code.trim().toUpperCase()}`,readAt=recentReads.get(readKey)||0;if(Date.now()-readAt<1500)throw new Error('Lectura repetida demasiado rápido: espera un instante.');recentReads.set(readKey,Date.now());
  const receptionPalletIds=await db.pallets.where('receptionId').equals(pallet.receptionId).primaryKeys();
  const firstParcel=await db.parcels.where('palletId').anyOf(receptionPalletIds).first();
  const patternMismatch=Boolean(firstParcel&&(firstParcel.code.length!==clean.code.length||/^\d+$/.test(firstParcel.code)!==/^\d+$/.test(clean.code)));
  const articleMismatch=Boolean(pallet.article && pallet.article !== clean.article);
  const anomalous=patternMismatch||articleMismatch;
  if (anomalous && !input.acceptAnomaly) {
    const reason=patternMismatch?`El primer código del camión tiene ${firstParcel?.code.length} caracteres y ${/^\d+$/.test(firstParcel?.code||'')?'sólo números':'letras o símbolos'}; esta lectura no sigue ese patrón.`:'La mocacota no coincide con las cajas anteriores de este palé.';
    throw new Error(`ANOMALY:${reason}`);
  }
  const now = iso();
  const anomaly:Anomaly|undefined=anomalous?{id:crypto.randomUUID(),createdAt:now,updatedAt:now,deletedAt:null,version:1,receptionId:pallet.receptionId,palletId:pallet.id,type:patternMismatch?'patron':'articulo',status:'aceptada',detail:patternMismatch?'Patrón distinto al primer bulto':'Artículo distinto al palé',reportedBy:input.operator,resolvedBy:input.operator,resolvedAt:now,resolution:'aceptada',photos:[]}:undefined;
  const parcel:Parcel = { id:crypto.randomUUID(),createdAt:now,updatedAt:now,deletedAt:null,version:1,code:clean.code,originalCode:input.originalCode??input.code,normalizedCode:clean.code.trim().toUpperCase(),ruleVersion:input.ruleVersion??pallet.ruleVersion??1,palletId:pallet.id,article:clean.article,mocacota:clean.mocacota,model:input.model,quality:input.quality,color:clean.color,size:clean.size,units:clean.units,originalUnits:clean.units,operator:input.operator,checkStatus:anomalous?'anomalia':'pendiente',anomalous,anomalyIds:anomaly?[anomaly.id]:[],photos:[] };
  const updated:Pallet = { ...pallet,article:pallet.article||clean.article,mocacota:pallet.mocacota||clean.mocacota,color:pallet.color||clean.color,size:pallet.size||clean.size,parcels:pallet.parcels+1,units:pallet.units+clean.units,status:pallet.status==='pendiente'?'escaneado':pallet.status,operator:input.operator,updatedAt:now,version:pallet.version+1 };
  const movement:Movement = { id:crypto.randomUUID(),createdAt:now,updatedAt:now,deletedAt:null,version:1,palletId:pallet.id,type:'escaneo',parcels:1,reason:`Bulto ${clean.code}`,operator:input.operator,deviceId:deviceId() };
  await db.transaction('rw',[db.parcels,db.pallets,db.movements,db.anomalies,db.operations],async()=>{
    await db.parcels.add(parcel); await db.pallets.put(updated); await db.movements.add(movement);
    if(anomaly)await db.anomalies.add(anomaly);await db.operations.bulkAdd([operation('parcel',parcel),operation('pallet',updated),operation('movement',movement),...(anomaly?[operation('anomaly',anomaly)]:[])]);
  });
  return {parcel,pallet:updated};
}

export async function createLocation(input:{code:string;zone:string;aisle:string;module:string;level:string;slot:string;capacity:number;multiple:boolean}) {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,30}$/.test(code)) throw new Error('El código de ubicación no es válido.');
  if (await db.locations.where('code').equals(code).first()) throw new Error('La ubicación ya existe.');
  const now=iso(); const location:Location={id:crypto.randomUUID(),createdAt:now,updatedAt:now,deletedAt:null,version:1,...input,code,status:'disponible'};
  await db.transaction('rw',[db.locations,db.operations],async()=>{await db.locations.add(location);await db.operations.add(operation('location',location));});
  return location;
}

export async function locatePallet(palletId:string,locationId:string,operator:string,reason='Ubicación confirmada') {
  const [pallet,location]=await Promise.all([db.pallets.get(palletId),db.locations.get(locationId)]);
  if(!pallet) throw new Error('Palé no encontrado.'); if(!location) throw new Error('Ubicación no encontrada.');
  if(!pallet.scanClosedAt) throw new Error('Cierra primero el palé después de escanear todos sus bultos.');
  if(location.status==='bloqueada') throw new Error('La ubicación está bloqueada.');
  if(location.status==='ocupada'&&!location.multiple&&pallet.locationId!==location.id) throw new Error('La ubicación ya está ocupada.');
  const now=iso(); const previous=pallet.locationId;
  const updatedPallet:Pallet={...pallet,locationId:location.id,status:'ubicado',locatedAt:now,updatedAt:now,version:pallet.version+1,operator};
  const updatedLocation:Location={...location,status:'ocupada',updatedAt:now,version:location.version+1};
  const movement:Movement={id:crypto.randomUUID(),createdAt:now,updatedAt:now,deletedAt:null,version:1,palletId:pallet.id,type:previous?'movimiento':'ubicacion',fromLocationId:previous,toLocationId:location.id,reason,operator,deviceId:deviceId()};
  await db.transaction('rw',[db.pallets,db.locations,db.movements,db.operations],async()=>{
    await db.pallets.put(updatedPallet);await db.locations.put(updatedLocation);await db.movements.add(movement);
    if(previous&&previous!==location.id){const old=await db.locations.get(previous);if(old){const oldUpdated={...old,status:'disponible' as const,updatedAt:now,version:old.version+1};await db.locations.put(oldUpdated);await db.operations.add(operation('location',oldUpdated));}}
    await db.operations.bulkAdd([operation('pallet',updatedPallet),operation('location',updatedLocation),operation('movement',movement)]);
  });
  return updatedPallet;
}

export async function extractPallet(palletId:string,parcelCount:number,reason:string,operator:string) {
  const pallet=await db.pallets.get(palletId);if(!pallet)throw new Error('Palé no encontrado.');
  if(parcelCount<1||parcelCount>pallet.parcels)throw new Error('La cantidad supera los bultos disponibles.');
  if(!reason.trim())throw new Error('Indica el motivo de la extracción.');
  const now=iso();const full=parcelCount===pallet.parcels;const unitsRemoved=full?pallet.units:Math.round((pallet.units/pallet.parcels)*parcelCount);
  const updated:Pallet={...pallet,parcels:pallet.parcels-parcelCount,units:Math.max(0,pallet.units-unitsRemoved),status:full?'extraido':pallet.status,extractedAt:full?now:pallet.extractedAt,locationId:full?undefined:pallet.locationId,updatedAt:now,version:pallet.version+1,operator};
  const movement:Movement={id:crypto.randomUUID(),createdAt:now,updatedAt:now,deletedAt:null,version:1,palletId:pallet.id,type:'extraccion',fromLocationId:pallet.locationId,parcels:parcelCount,reason:reason.trim(),operator,deviceId:deviceId()};
  await db.transaction('rw',[db.pallets,db.locations,db.movements,db.operations],async()=>{
    await db.pallets.put(updated);await db.movements.add(movement);
    if(full&&pallet.locationId){const location=await db.locations.get(pallet.locationId);if(location){const free={...location,status:'disponible' as const,updatedAt:now,version:location.version+1};await db.locations.put(free);await db.operations.add(operation('location',free));}}
    await db.operations.bulkAdd([operation('pallet',updated),operation('movement',movement)]);
  });
  return updated;
}

export async function closeReception(id:string) {
  const item=await db.receptions.get(id);if(!item)throw new Error('Recepción no encontrada.');
  const pallets=(await db.pallets.where('receptionId').equals(id).toArray()).filter(p=>!p.deletedAt);
  if(pallets.length!==item.expectedPallets||pallets.some(p=>!p.scanClosedAt||p.status!=='ubicado'))throw new Error('Para cerrar el camión, todos los palés deben estar completos y ubicados.');
  const now=iso();const updated={...item,status:'cerrada' as const,lockedAt:now,updatedAt:now,version:item.version+1};
  await db.transaction('rw',[db.receptions,db.operations],async()=>{await db.receptions.put(updated);await db.operations.add(operation('reception',updated));});
}

export async function setExpectedParcels(palletId:string,count:number,operator:string){
  const pallet=await db.pallets.get(palletId);if(!pallet)throw new Error('Palé no encontrado.');if(pallet.scanClosedAt)throw new Error('El palé ya está cerrado.');if(!Number.isInteger(count)||count<1||count< pallet.parcels)throw new Error('Indica una cantidad válida, igual o mayor que las cajas ya leídas.');
  const updated={...pallet,expectedParcels:count,operator,updatedAt:iso(),version:pallet.version+1};await db.transaction('rw',[db.pallets,db.operations],async()=>{await db.pallets.put(updated);await db.operations.add(operation('pallet',updated))});return updated;
}

export async function closePallet(palletId:string,operator:string){
  const pallet=await db.pallets.get(palletId);if(!pallet)throw new Error('Palé no encontrado.');if(pallet.parcels<1)throw new Error('Escanea al menos una caja antes de cerrar.');if(pallet.expectedParcels&&pallet.parcels!==pallet.expectedParcels)throw new Error(`Faltan ${pallet.expectedParcels-pallet.parcels} cajas por escanear.`);
  const now=iso();const updated:Pallet={...pallet,expectedParcels:pallet.expectedParcels||pallet.parcels,scanClosedAt:now,status:'escaneado',operator,updatedAt:now,version:pallet.version+1};const movement:Movement={id:crypto.randomUUID(),createdAt:now,updatedAt:now,deletedAt:null,version:1,palletId,type:'cierre_pale',parcels:pallet.parcels,reason:'Palé completo y cerrado',operator,deviceId:deviceId()};
  await db.transaction('rw',[db.pallets,db.movements,db.operations],async()=>{await db.pallets.put(updated);await db.movements.add(movement);await db.operations.bulkAdd([operation('pallet',updated),operation('movement',movement)])});return updated;
}

export async function reopenPallet(palletId:string,operator:string){const pallet=await db.pallets.get(palletId);if(!pallet)throw new Error('Palé no encontrado.');const updated:Pallet={...pallet,scanClosedAt:undefined,status:pallet.locationId?'ubicado':pallet.parcels?'escaneado':'pendiente',operator,updatedAt:iso(),version:pallet.version+1};await db.transaction('rw',[db.pallets,db.operations],async()=>{await db.pallets.put(updated);await db.operations.add(operation('pallet',updated))});return updated}

export async function unlockReceptionForExtraction(id:string){const item=await db.receptions.get(id);if(!item)throw new Error('Recepción no encontrada.');if(item.status!=='cerrada')throw new Error('Primero debes cerrar y bloquear el camión.');const updated={...item,extractionUnlockedAt:iso(),updatedAt:iso(),version:item.version+1};await db.transaction('rw',[db.receptions,db.operations],async()=>{await db.receptions.put(updated);await db.operations.add(operation('reception',updated))});return updated}

export async function assignExtractionTasks(palletIds:string[],assignee:string,operator:string){if(!assignee.trim())throw new Error('Indica el operario asignado.');const now=iso();const pallets=(await db.pallets.bulkGet(palletIds)).filter((p):p is Pallet=>Boolean(p));for(const pallet of pallets){const reception=await db.receptions.get(pallet.receptionId);if(!reception?.extractionUnlockedAt)throw new Error(`El camión de ${pallet.code} no está desbloqueado para extracción.`);if(pallet.status!=='ubicado')throw new Error(`${pallet.code} no está ubicado en rack.`)}const updated=pallets.map(p=>({...p,taskStatus:'pendiente' as const,taskAssignee:assignee.trim(),taskCreatedBy:operator,taskCreatedAt:now,updatedAt:now,version:p.version+1}));const movements:Movement[]=updated.map(p=>({id:crypto.randomUUID(),createdAt:now,updatedAt:now,deletedAt:null,version:1,palletId:p.id,type:'orden_extraccion',reason:`Orden asignada a ${assignee.trim()}`,operator,deviceId:deviceId()}));await db.transaction('rw',[db.pallets,db.movements,db.operations],async()=>{await db.pallets.bulkPut(updated);await db.movements.bulkAdd(movements);await db.operations.bulkAdd([...updated.map(p=>operation('pallet',p)),...movements.map(m=>operation('movement',m))])});return updated}

export async function moveTaskToFloor(palletId:string,locationCode:string,palletCode:string,confirmedLocationCode:string,operator:string){const pallet=await db.pallets.get(palletId);if(!pallet||!pallet.locationId)throw new Error('El palé no está ubicado.');const location=await db.locations.get(pallet.locationId);if(!location)throw new Error('No se encuentra la ubicación actual.');if(pallet.taskStatus!=='pendiente'&&pallet.taskStatus!=='en_curso')throw new Error('Este palé no tiene una orden activa.');if(location.code!==locationCode.trim().toUpperCase()||location.code!==confirmedLocationCode.trim().toUpperCase())throw new Error('La ubicación inicial y la confirmación no coinciden con el rack asignado.');if(pallet.code!==palletCode.trim().toUpperCase())throw new Error('El QR escaneado no corresponde al palé de la tarea.');const now=iso();const updated:Pallet={...pallet,status:'en_suelo',locationId:undefined,floorAt:now,taskStatus:'completada',operator,updatedAt:now,version:pallet.version+1};const free:Location={...location,status:'disponible',updatedAt:now,version:location.version+1};const movement:Movement={id:crypto.randomUUID(),createdAt:now,updatedAt:now,deletedAt:null,version:1,palletId,type:'suelo',fromLocationId:location.id,reason:'Extraído del rack y depositado en suelo',operator,deviceId:deviceId()};await db.transaction('rw',[db.pallets,db.locations,db.movements,db.operations],async()=>{await db.pallets.put(updated);await db.locations.put(free);await db.movements.add(movement);await db.operations.bulkAdd([operation('pallet',updated),operation('location',free),operation('movement',movement)])});return updated}
