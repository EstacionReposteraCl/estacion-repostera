// Cifrado simétrico (AES-256-GCM) para guardar credenciales de integraciones en la bitácora sin dejarlas en texto plano.
// La llave se deriva del secreto del servidor (BETTER_AUTH_SECRET): sin él, lo guardado no se puede leer.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const keyFrom = (secret: string, purpose: string) => createHash('sha256').update(`${purpose}\u0000${secret}`).digest();

export function seal(plain: string, secret: string, purpose: string): string {
  if (!secret || secret.length < 16) throw new Error('Secreto del servidor no configurado');
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', keyFrom(secret, purpose), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function open(box: string, secret: string, purpose: string): string | null {
  try {
    const [v, iv, tag, enc] = box.split('.'); if (v !== 'v1' || !iv || !tag || !enc) return null;
    const d = createDecipheriv('aes-256-gcm', keyFrom(secret, purpose), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; }
}
