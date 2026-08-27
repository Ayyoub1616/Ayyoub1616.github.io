CREATE TABLE IF NOT EXISTS trash_actions (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  identifier TEXT NOT NULL,
  reason TEXT NOT NULL,
  snapshot_key TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  impact_json TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  restored_at TEXT,
  restored_by TEXT,
  restore_reason TEXT,
  restore_idempotency_key TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_trash_actions_target ON trash_actions(target_type,target_id,deleted_at);
CREATE INDEX IF NOT EXISTS idx_trash_actions_restored ON trash_actions(restored_at,deleted_at);
CREATE INDEX IF NOT EXISTS idx_entities_reception_id
ON entities(json_extract(data_json,'$.receptionId'))
WHERE entity_type IN ('pallet','anomaly');
CREATE INDEX IF NOT EXISTS idx_entities_pallet_id
ON entities(json_extract(data_json,'$.palletId'))
WHERE entity_type IN ('parcel','movement','anomaly');
PRAGMA optimize;
