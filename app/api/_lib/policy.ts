import type {EntityType,Role} from '../../lib/types';
export function canWriteEntity(role:Role,type:EntityType,action:'upsert'|'delete'){const actual=role==='manager'?'admin':role;
  // Los tombstones se crean únicamente en /api/trash, donde se exige impacto,
  // reautenticación, motivo, confirmación exacta, snapshot e idempotencia.
  if(action==='delete')return false;
  if(actual==='admin')return true;
  if(actual==='coordinador')return !['barcodeRule','audit'].includes(type);
  return ['parcel','pallet','movement','anomaly'].includes(type)}
