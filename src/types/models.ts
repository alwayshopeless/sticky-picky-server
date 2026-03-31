export interface StickerPayload {
  repository: string;
  body: string;
  url: string;
  info: unknown;
}

export interface StickerpackStickerRow {
  id: number;
  stickerpack_id: number;
  body: string;
  url: string;
  info: unknown;
  sort_order: number;
}

export interface StickerpackStickerView extends StickerpackStickerRow {
  repository: string;
  stickerpack_type: string;
}

export interface UserRow {
  id: number;
  token: string | null;
  matrix_id: string;
  favorites: string | null;
  recent: string | null;
}

export interface StickerpackRow {
  id: number;
  repository: string;
  homeserver: string;
  name: string;
  internal_name: string;
  type: string;
  owner_user_id: number | null;
  visibility: 'private' | 'public';
  share_id: string;
  parent_ref: string | null;
  parent_share_id: string | null;
  parent_media_homeserver: string | null;
  source_aggregator_host: string | null;
  import_target_homeserver: string | null;
  created_at: string;
  updated_at: string;
}

export interface StickerpackCountRow {
  total: number;
}

export interface StickerWithUid extends StickerPayload {
  spUid: string;
}
