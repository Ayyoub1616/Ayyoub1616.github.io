import { env } from 'cloudflare:workers';

const statements = [
  `CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'operario',
    permissions_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, data_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, deleted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS operations (
    id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, action TEXT NOT NULL,
    payload_json TEXT NOT NULL, actor_user_id TEXT NOT NULL, device_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS cloud_backups (
    id TEXT PRIMARY KEY, operator_name TEXT NOT NULL, data_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    id TEXT PRIMARY KEY, ip_address TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS app_users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, role TEXT NOT NULL,
    permissions_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS security_audit (
    id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, target_type TEXT,
    target_id TEXT, correlation_id TEXT NOT NULL, detail_json TEXT NOT NULL,
    ip_address TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pallet_qr_claims (qr TEXT PRIMARY KEY, pallet_id TEXT NOT NULL UNIQUE)`,
  `CREATE TABLE IF NOT EXISTS parcel_claims (pallet_id TEXT NOT NULL, code TEXT NOT NULL, parcel_id TEXT NOT NULL UNIQUE, PRIMARY KEY(pallet_id,code))`,
  `CREATE TABLE IF NOT EXISTS location_claims (location_id TEXT PRIMARY KEY, pallet_id TEXT NOT NULL UNIQUE)`,
  `CREATE TABLE IF NOT EXISTS sync_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL UNIQUE, entity_id TEXT NOT NULL, entity_type TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS photo_objects (id TEXT PRIMARY KEY, object_key TEXT NOT NULL UNIQUE, anomaly_id TEXT, parcel_id TEXT, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, operator TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS cycle_counts (id TEXT PRIMARY KEY, aisle TEXT NOT NULL, expected INTEGER NOT NULL, observed INTEGER NOT NULL, difference INTEGER NOT NULL, operator TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_events_sequence ON sync_events(sequence)`,
  `CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status)`,
  `CREATE INDEX IF NOT EXISTS idx_entities_type_updated ON entities(entity_type, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_operations_created ON operations(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_cloud_backups_created ON cloud_backups(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_created ON login_attempts(ip_address,created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_app_users_status ON app_users(status)`,
  `CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit(created_at)`,
];

let ready: Promise<void> | null = null;

export function getD1(): D1Database {
  if (!env.DB) throw new Error('La base de datos no está disponible.');
  return env.DB;
}

export async function ensureSchema(): Promise<void> {
  if (!ready) ready = getD1().batch(statements.map((sql) => getD1().prepare(sql))).then(() => undefined);
  return ready;
}
