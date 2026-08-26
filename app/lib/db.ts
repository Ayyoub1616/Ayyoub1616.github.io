import Dexie, { type EntityTable } from 'dexie';
import type { Anomaly, AuditChange, BarcodeRule, Location, Movement, Pallet, Parcel, PendingOperation, Reception } from './types';

export class PalletFlowDB extends Dexie {
  receptions!: EntityTable<Reception, 'id'>;
  pallets!: EntityTable<Pallet, 'id'>;
  parcels!: EntityTable<Parcel, 'id'>;
  locations!: EntityTable<Location, 'id'>;
  movements!: EntityTable<Movement, 'id'>;
  barcodeRules!: EntityTable<BarcodeRule, 'id'>;
  anomalies!: EntityTable<Anomaly, 'id'>;
  audits!: EntityTable<AuditChange, 'id'>;
  operations!: EntityTable<PendingOperation, 'id'>;

  constructor(name = 'palletflow-warehouse') {
    super(name);
    this.version(1).stores({
      receptions: 'id, reference, status, updatedAt, demo',
      pallets: 'id, &code, receptionId, status, locationId, article, updatedAt, demo',
      parcels: 'id, &code, palletId, article, updatedAt, demo',
      locations: 'id, &code, status, zone, updatedAt, demo',
      movements: 'id, palletId, type, createdAt, demo',
      operations: 'id, entityId, entityType, createdAt, attempts',
    });
    // Los códigos de bulto de Inditex pueden repetirse: cada lectura física
    // queda identificada por su propio id y por el palé al que pertenece.
    this.version(2).stores({
      receptions: 'id, reference, status, updatedAt, demo',
      pallets: 'id, &code, receptionId, status, locationId, article, updatedAt, demo',
      parcels: 'id, code, palletId, article, updatedAt, demo',
      locations: 'id, &code, status, zone, updatedAt, demo',
      movements: 'id, palletId, type, createdAt, demo',
      operations: 'id, entityId, entityType, createdAt, attempts',
    });
    this.version(3).stores({
      receptions: 'id, reference, status, receivedAt, activeRuleVersion, updatedAt, demo',
      pallets: 'id, &code, receptionId, status, locationId, article, mocacota, checkStatus, updatedAt, demo',
      parcels: 'id, code, normalizedCode, palletId, article, mocacota, checkStatus, ruleVersion, updatedAt, demo',
      locations: 'id, &code, masterKey, status, zone, aisle, level, updatedAt, demo',
      movements: 'id, palletId, type, createdAt, demo',
      barcodeRules: 'id, &ruleNumber, active, createdAt',
      anomalies: 'id, receptionId, palletId, parcelId, type, status, createdAt',
      audits: 'id, entityType, entityId, field, createdAt',
      operations: 'id, entityId, entityType, createdAt, attempts',
    }).upgrade(async tx=>{
      await tx.table('receptions').toCollection().modify(r=>{r.readingMode??='fisico';r.checkStatus??='pendiente';r.activeRuleVersion??=1});
      await tx.table('pallets').toCollection().modify(p=>{p.originalCode??=p.code;p.normalizedCode??=String(p.code).trim().toUpperCase();p.ruleVersion??=1;p.checkStatus??='pendiente';p.photos??=[]});
      await tx.table('parcels').toCollection().modify(p=>{p.originalCode??=p.code;p.normalizedCode??=String(p.code).trim().toUpperCase();p.ruleVersion??=1;p.checkStatus??=(p.anomalous?'anomalia':'pendiente');p.photos??=[];p.anomalyIds??=[]});
      await tx.table('locations').toCollection().modify(l=>{l.masterKey??=l.code;l.coordinate??=l.code;l.maxParcels??=l.capacity});
    });
  }
}

export const db = new PalletFlowDB();

export function deviceId(): string {
  if (typeof window === 'undefined') return 'server-device';
  const key = 'palletflow-device-id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}
