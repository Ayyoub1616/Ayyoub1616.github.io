import type {EntityType,Role} from '../../lib/types';
export function canWriteEntity(role:Role,type:EntityType,action:'upsert'|'delete'){const actual=role==='manager'?'admin':role;if(actual==='admin')return true;if(action==='delete')return false;if(actual==='coordinador')return !['barcodeRule','audit'].includes(type);return ['parcel','pallet','movement','anomaly'].includes(type)}
