/**
 * Resolve-style .cube 3D LUT parser.
 *
 * Supported header tokens (case-insensitive):
 *   - LUT_3D_SIZE <N>          (required — only 3D LUTs are supported)
 *   - DOMAIN_MIN <r> <g> <b>   (optional, default 0 0 0)
 *   - DOMAIN_MAX <r> <g> <b>   (optional, default 1 1 1)
 *   - TITLE "..."              (ignored)
 *
 * Body: N³ lines of "R G B" floats. R varies fastest, then G, then B.
 *
 * The returned `data` is a flat Float32Array of length N³*3, ordered so that
 * the entry for (r, g, b) sits at index `(b*N*N + g*N + r) * 3` — the same
 * order as the file. This matches how WebGL2 `texImage3D` expects RGB voxels
 * when uploaded with row-major `(width=R, height=G, depth=B)`.
 */
export interface CubeLut {
  size: number;
  data: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

export function parseCube(text: string): CubeLut {
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const samples: number[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const upper = line.toUpperCase();
    if (upper.startsWith("TITLE")) continue;
    if (upper.startsWith("LUT_1D_SIZE")) {
      throw new Error("1D LUTs are not supported — use LUT_3D_SIZE.");
    }
    if (upper.startsWith("LUT_3D_SIZE")) {
      const m = line.match(/LUT_3D_SIZE\s+(\d+)/i);
      if (!m) throw new Error(`malformed LUT_3D_SIZE line: ${line}`);
      size = Number(m[1]);
      continue;
    }
    if (upper.startsWith("DOMAIN_MIN")) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) {
        domainMin = [parts[0], parts[1], parts[2]];
      }
      continue;
    }
    if (upper.startsWith("DOMAIN_MAX")) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) {
        domainMax = [parts[0], parts[1], parts[2]];
      }
      continue;
    }

    const nums = line.split(/\s+/).map(Number);
    if (nums.length === 3 && nums.every((v) => Number.isFinite(v))) {
      samples.push(nums[0], nums[1], nums[2]);
    }
  }

  if (size <= 1) throw new Error("missing or invalid LUT_3D_SIZE");
  const expected = size * size * size * 3;
  if (samples.length !== expected) {
    throw new Error(
      `LUT body has ${samples.length / 3} entries, expected ${size ** 3} (${size}³).`,
    );
  }
  return {
    size,
    data: Float32Array.from(samples),
    domainMin,
    domainMax,
  };
}

/** Build an N³ identity LUT — passes input colors through unchanged. */
export function identityLut(size = 33): CubeLut {
  const data = new Float32Array(size * size * size * 3);
  let idx = 0;
  const denom = size - 1;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        data[idx++] = r / denom;
        data[idx++] = g / denom;
        data[idx++] = b / denom;
      }
    }
  }
  return { size, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}
