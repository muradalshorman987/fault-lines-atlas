// vercel.json: the build settings stay, and every page gets a strict CSP that lets the browser talk only to
// the site itself, Anthropic's API (Ask Claude with the visitor's key) and the detailed map's tile hosts.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
interface Header { key: string; value: string }
interface VercelConfig { framework?: string; buildCommand?: string; outputDirectory?: string; headers?: { source: string; headers: Header[] }[] }
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as VercelConfig;

const forAll = cfg.headers?.find((h) => h.source === '/(.*)')?.headers ?? [];
const header = (name: string) => forAll.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value;
const csp = header('Content-Security-Policy') ?? '';
const directives = new Map(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
  const [name, ...values] = d.split(/\s+/);
  return [name!, values] as const;
}));
const dir = (name: string) => directives.get(name) ?? [];

describe('vercel.json', () => {
  test('keeps the existing build settings', () => {
    expect(cfg.framework).toBe('vite');
    expect(cfg.buildCommand).toBe('npm run build');
    expect(cfg.outputDirectory).toBe('dist');
  });

  test('the CSP allows connections only to self, Anthropic and the tile hosts', () => {
    expect(dir('connect-src')).toContain('https://api.anthropic.com');
    expect(dir('connect-src')).toContain("'self'");
    for (const src of dir('connect-src')) {
      expect(["'self'", 'https://api.anthropic.com', 'https://tiles.openfreemap.org']).toContain(src);
    }
  });

  test('the CSP forbids framing, plugins, form posts and foreign base URLs', () => {
    expect(dir('frame-ancestors')).toEqual(["'none'"]);
    expect(dir('default-src')).toEqual(["'self'"]);
    expect(dir('base-uri')).toEqual(["'self'"]);
    expect(dir('form-action')).toEqual(["'none'"]);
    expect(dir('object-src')).toEqual(["'none'"]);
  });

  test('scripts run only from the site (no inline or eval) except the hashed pre-paint script', () => {
    const script = dir('script-src');
    expect(script[0]).toBe("'self'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    // Every inline <script> in index.html must be listed by hash, or the browser blocks it.
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(inline.length).toBeGreaterThan(0);
    for (const body of inline) expect(script).toContain(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  });

  test('styles, fonts, images and the map workers have exactly what the app needs', () => {
    expect(dir('style-src')).toEqual(["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']);
    expect(dir('font-src')).toEqual(["'self'", 'https://fonts.gstatic.com']);
    expect(dir('img-src')).toEqual(["'self'", 'data:', 'blob:']);
    // MapLibre's worker is a same-origin module asset (no blob: needed); the site has no frames.
    expect(dir('worker-src')).toEqual(["'self'"]);
    expect(dir('frame-src')).toEqual(["'none'"]);
    expect(dir('child-src')).toEqual([]);
  });

  test('the other security headers', () => {
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    const perms = header('Permissions-Policy') ?? '';
    for (const p of ['camera=()', 'microphone=()', 'geolocation=()']) expect(perms).toContain(p);
  });
});
