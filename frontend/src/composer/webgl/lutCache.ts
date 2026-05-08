import type { ColorPreset } from "../../types";
import { identityLut, parseCube, type CubeLut } from "./parseCube";

/**
 * Per-URL .cube fetch + parse cache. Promises are cached so concurrent callers
 * coalesce on a single network request. Failures are NOT cached — a transient
 * 404 (e.g. backend not yet started) shouldn't poison the slot forever.
 */
const inflight = new Map<string, Promise<CubeLut>>();
const resolved = new Map<string, CubeLut>();

let _identity: CubeLut | null = null;
export function getIdentityLut(): CubeLut {
  if (!_identity) _identity = identityLut(33);
  return _identity;
}

export function lutUrlForPreset(preset: ColorPreset): string {
  return `/luts/${preset}.cube`;
}

export function loadLut(url: string): Promise<CubeLut> {
  const cached = resolved.get(url);
  if (cached) return Promise.resolve(cached);
  const inflightP = inflight.get(url);
  if (inflightP) return inflightP;

  const p = fetch(url, { credentials: "omit" })
    .then(async (res) => {
      if (!res.ok) throw new Error(`LUT fetch failed: ${url} (${res.status})`);
      const text = await res.text();
      const parsed = parseCube(text);
      resolved.set(url, parsed);
      return parsed;
    })
    .finally(() => {
      inflight.delete(url);
    });
  inflight.set(url, p);
  return p;
}

/** Synchronous accessor — returns null until `loadLut(url)` resolves. */
export function getLutSync(url: string): CubeLut | null {
  return resolved.get(url) ?? null;
}
