import crypto from 'node:crypto';

export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function generateSpUid() {
  return `sp-uid-${crypto.randomBytes(8).toString('hex')}`;
}

export function generateStickerpackShareId() {
  return crypto.randomBytes(12).toString('base64url');
}
