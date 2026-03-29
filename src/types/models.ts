export interface StickerPayload {
  repository: string;
  body: string;
  url: string;
  info: unknown;
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
}

export interface StickerpackCountRow {
  total: number;
}

export interface StickerWithUid extends StickerPayload {
  spUid: string;
}
