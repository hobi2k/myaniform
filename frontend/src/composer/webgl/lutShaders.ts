/**
 * Shaders for the LUT-graded video pipeline.
 *
 * Pipeline:
 *   1. Sample the source video (2D texture) at the fragment's UV.
 *   2. Apply the per-clip LUT (sampler3D) — identity if not active.
 *   3. Apply the global LUT (sampler3D) — identity if not active.
 *   4. Output to canvas.
 *
 * The LUT lookup uses GL_LINEAR on a 33³ texture, matching ffmpeg's `lut3d`
 * default trilinear interpolation. The N=33 grid is the same size baked by
 * `scripts/generate_color_luts.py`.
 *
 * Sampler convention: the LUT 3D texture is laid out (width=R, height=G,
 * depth=B). Texel center for grid point (i,j,k) sits at
 * `((i+0.5)/N, (j+0.5)/N, (k+0.5)/N)`. To avoid edge bleeding we scale by
 * `(N-1)/N` and bias by `0.5/N`, identical to typical .cube samplers.
 */

export const LUT_VERT_SHADER = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2((aPos.x + 1.0) * 0.5, 1.0 - (aPos.y + 1.0) * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const LUT_FRAG_SHADER = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uVideo;
uniform sampler3D uLutClip;
uniform sampler3D uLutGlobal;
uniform float uClipEnabled;
uniform float uGlobalEnabled;
uniform float uLutSize; // e.g. 33.0

vec3 sampleLut3D(sampler3D lut, vec3 c) {
  // Map [0..1] linearly to texel-centered coords on an N-grid texture.
  float scale = (uLutSize - 1.0) / uLutSize;
  float bias = 0.5 / uLutSize;
  vec3 uvw = clamp(c, 0.0, 1.0) * scale + bias;
  return texture(lut, uvw).rgb;
}

void main() {
  vec4 src = texture(uVideo, vUv);
  vec3 c = src.rgb;

  if (uClipEnabled > 0.5) {
    c = sampleLut3D(uLutClip, c);
  }
  if (uGlobalEnabled > 0.5) {
    c = sampleLut3D(uLutGlobal, c);
  }

  outColor = vec4(c, src.a);
}
`;
