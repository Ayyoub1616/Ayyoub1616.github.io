export type ProfileRow = {
  id: string; user_id: string; email: string; display_name: string;
  role: 'operario' | 'coordinador' | 'admin' | 'manager'; permissions_json: string;
  status: 'pending' | 'active' | 'blocked'; created_at: string; updated_at: string;
};

export type EntityRow = {
  id: string; entity_type: string; data_json: string; version: number;
  updated_at: string; deleted_at: string | null;
};
