import { db } from './db';
import type { Location, Movement, Pallet, Parcel, Reception } from './types';

const now = () => new Date().toISOString();
const base = () => ({ id:crypto.randomUUID(), createdAt:now(), updatedAt:now(), deletedAt:null, version:1, demo:true as const });

export async function loadDemoData() {
  const stamp = now();
  const receptions: Reception[] = [
    { ...base(), reference:'DEMO-REC-2408', vehicle:'TEST-001', receivedAt:'2026-08-24', expectedPallets:4, notes:'Descarga ficticia de formación', status:'descarga' },
    { ...base(), reference:'DEMO-REC-2308', vehicle:'TEST-002', receivedAt:'2026-08-23', expectedPallets:3, notes:'Datos simulados', status:'completada' },
  ];
  const locations: Location[] = ['A-01-01-01','A-01-01-02','A-01-02-01','B-02-01-01','B-02-01-02','C-01-01-01'].map((code,index) => {
    const [zone,aisle,module,slot] = code.split('-');
    return { ...base(), code, zone, aisle, module, level:'01', slot, capacity:1, multiple:false, status:index < 3 ? 'ocupada':'disponible' };
  });
  const pallets: Pallet[] = Array.from({length:6},(_,index) => ({
    ...base(), code:`PAL-DEMO-${String(index+1).padStart(3,'0')}`, number:index+1,
    receptionId:receptions[index < 4 ? 0 : 1].id, status:index < 3 ? 'ubicado': index < 5 ? 'escaneado':'pendiente',
    article:index % 2 ? '841780162002' : '841780162001', mocacota:index % 2 ? '841780162002' : '841780162001', color:index%2 ? 'MARFIL':'GRAFITO', size:index%3===0?'M':'L', parcels:index === 5 ? 0 : 4+index, units:index === 5 ? 0 : (4+index)*12,
    expectedParcels:index === 5 ? undefined : 4+index, scanClosedAt:index === 5 ? undefined : stamp,
    tone:index%2 ? 'Marfil':'Grafito', notes:'Palé ficticio', operator:'Operario demo',
    locationId:index < 3 ? locations[index].id:undefined, locatedAt:index < 3 ? stamp:undefined,
  }));
  const parcels: Parcel[] = pallets.flatMap((pallet) => Array.from({length:pallet.parcels},(_,index) => ({
    ...base(), code:`BLT-${pallet.code.slice(-3)}-${String(index+1).padStart(3,'0')}`, palletId:pallet.id,
    article:pallet.article, mocacota:pallet.mocacota, color:pallet.color, size:pallet.size, units:12, operator:'Operario demo', anomalous:false,
  })));
  const movements: Movement[] = pallets.map((pallet) => ({
    ...base(), palletId:pallet.id, type:pallet.locationId?'ubicacion':'creacion', toLocationId:pallet.locationId,
    reason:'Carga de demostración', operator:'Operario demo', deviceId:'demo-device',
  }));
  await db.transaction('rw',[db.receptions,db.pallets,db.parcels,db.locations,db.movements],async()=>{
    await Promise.all([db.receptions.bulkPut(receptions),db.pallets.bulkPut(pallets),db.parcels.bulkPut(parcels),db.locations.bulkPut(locations),db.movements.bulkPut(movements)]);
  });
}

export async function clearDemoData() {
  await db.transaction('rw',[db.receptions,db.pallets,db.parcels,db.locations,db.movements],async()=>{
    await Promise.all([db.receptions.where('demo').equals(1).delete(),db.pallets.where('demo').equals(1).delete(),db.parcels.where('demo').equals(1).delete(),db.locations.where('demo').equals(1).delete(),db.movements.where('demo').equals(1).delete()]);
  });
}
