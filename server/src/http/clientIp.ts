import type { Request } from 'express';
import { isIP } from 'node:net';
import { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config.js';

export function clientAddress(req: Request): { ip: string; source: 'render' | 'socket' } {
  // Render documents that Cloudflare overwrites this header on public web services.
  // Never trust it on a direct/local deployment, or take the caller's leftmost XFF entry.
  const forwarded = req.get('cf-connecting-ip')?.trim();
  if (config.clientIpSource === 'render' && forwarded && isIP(forwarded)) return { ip: forwarded, source: 'render' };
  return { ip: req.socket.remoteAddress ?? 'unknown', source: 'socket' };
}

export function clientRateKey(req: Request): string {
  const { ip } = clientAddress(req);
  const unmapped = ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
  // Group IPv6 /56 addresses so rotating interface addresses cannot evade the quota.
  return isIP(unmapped) ? ipKeyGenerator(unmapped, 56) : 'unknown';
}
