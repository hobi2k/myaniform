import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { getIdentityLut, getLutSync, loadLut } from "./lutCache";
import { LUT_FRAG_SHADER, LUT_VERT_SHADER } from "./lutShaders";
import type { CubeLut } from "./parseCube";

/**
 * Display element that pipes a `<video>` (or `<img>`) through a WebGL2
 * fragment shader applying up to two stacked 3D LUTs (per-clip → global).
 *
 * Why this matters for Strategy A
 * --------------------------------
 * The same `.cube` files served at `/luts/<preset>.cube` are baked into the
 * ffmpeg final render via the `lut3d=...` filter (see
 * `backend/services/ffmpeg_utils.py::color_filter_chain`). Sampling the same
 * data with trilinear interpolation in WebGL2 gives a pixel-perfect preview
 * — what you see in the timeline is what ffmpeg writes to disk.
 *
 * Forwarded ref
 * -------------
 * We forward the underlying `<video>` element so existing consumers
 * (`useClipSync`, `useAudioRoute`) keep working unchanged. The `<video>` is
 * present in the DOM but offscreen; the visible output comes from the
 * `<canvas>`.
 *
 * Graceful fallback
 * -----------------
 * If WebGL2 is unavailable or the LUT files fail to load, we render the
 * `<video>` directly (visible) so playback never breaks. CSS `filter` from
 * `colorGradeFilter()` can still approximate the look in that path.
 */
interface Props {
  src: string;
  /** URL to the per-clip LUT (.cube). null → no per-clip grade. */
  lutClipUrl?: string | null;
  /** URL to the global preset LUT (.cube). null → no global grade. */
  lutGlobalUrl?: string | null;
  /** Mirror `<video>` props that consumers set. */
  muted?: boolean;
  playsInline?: boolean;
  preload?: "auto" | "metadata" | "none";
  /** Fallback CSS filter applied when the WebGL path is inactive. */
  fallbackFilter?: string;
  style?: CSSProperties;
  className?: string;
}

const FB_OBJECT_FIT: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  background: "#000",
};

export type LUTVideoHandle = HTMLVideoElement;

const LUTVideo = forwardRef<LUTVideoHandle, Props>(function LUTVideo(
  {
    src,
    lutClipUrl,
    lutGlobalUrl,
    muted,
    playsInline,
    preload,
    fallbackFilter,
    style,
    className,
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Forward the inner <video> to the parent. useClipSync etc. need it.
  useImperativeHandle(ref, () => videoRef.current as HTMLVideoElement, []);

  const [glReady, setGlReady] = useState(false);
  const [lutsReady, setLutsReady] = useState(false);
  const glStateRef = useRef<GLState | null>(null);

  // Eager-fetch any non-null LUT URLs the moment they appear.
  useEffect(() => {
    let cancelled = false;
    const urls = [lutClipUrl, lutGlobalUrl].filter((u): u is string => !!u);
    if (urls.length === 0) {
      setLutsReady(true);
      return;
    }
    setLutsReady(false);
    Promise.all(urls.map((u) => loadLut(u).catch(() => null))).then(() => {
      if (!cancelled) setLutsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [lutClipUrl, lutGlobalUrl]);

  const useWebgl = glReady && lutsReady;

  // One-time GL init.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, alpha: false });
    if (!gl) {
      console.warn("[LUTVideo] WebGL2 not available; falling back to plain <video>");
      return;
    }
    const state = initGl(gl);
    if (!state) return;
    glStateRef.current = state;
    setGlReady(true);
    return () => {
      const g = state.gl;
      g.deleteProgram(state.program);
      g.deleteBuffer(state.quad);
      g.deleteVertexArray(state.vao);
      g.deleteTexture(state.videoTex);
      g.deleteTexture(state.lutClipTex);
      g.deleteTexture(state.lutGlobalTex);
      glStateRef.current = null;
    };
  }, []);

  // Resolve LUT data (sync — cache should be ready now). null = identity.
  const clipLut = useMemo<CubeLut | null>(
    () => (lutClipUrl ? getLutSync(lutClipUrl) : null),
    [lutClipUrl, lutsReady],
  );
  const globalLut = useMemo<CubeLut | null>(
    () => (lutGlobalUrl ? getLutSync(lutGlobalUrl) : null),
    [lutGlobalUrl, lutsReady],
  );

  // Push LUTs into 3D textures whenever they change.
  useEffect(() => {
    const st = glStateRef.current;
    if (!st || !useWebgl) return;
    const identity = getIdentityLut();
    upload3DLut(st.gl, st.lutClipTex, clipLut ?? identity);
    upload3DLut(st.gl, st.lutGlobalTex, globalLut ?? identity);
  }, [clipLut, globalLut, useWebgl]);

  // RAF render loop: each frame, copy <video> to a 2D texture and draw.
  const render = useCallback(() => {
    const st = glStateRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!st || !video || !canvas) return;
    const w = video.videoWidth || canvas.width;
    const h = video.videoHeight || canvas.height;
    if (w === 0 || h === 0) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const { gl, program, vao, videoTex, lutClipTex, lutGlobalTex } = st;
    gl.viewport(0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      video,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.uniform1i(st.uVideoLoc, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, lutClipTex);
    gl.uniform1i(st.uLutClipLoc, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, lutGlobalTex);
    gl.uniform1i(st.uLutGlobalLoc, 2);

    gl.uniform1f(st.uClipEnabledLoc, clipLut ? 1.0 : 0.0);
    gl.uniform1f(st.uGlobalEnabledLoc, globalLut ? 1.0 : 0.0);
    gl.uniform1f(st.uLutSizeLoc, (clipLut ?? globalLut ?? getIdentityLut()).size);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }, [clipLut, globalLut]);

  // Drive the GL render. Two triggers: rAF while the video plays, and a
  // `requestVideoFrameCallback` ping when paused (so seeks redraw too).
  useEffect(() => {
    if (!useWebgl) return;
    const video = videoRef.current;
    if (!video) return;
    let rafId = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      render();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    type RVFC = (
      cb: (now: number, metadata: unknown) => void,
    ) => number;
    const rvfc = (
      video as HTMLVideoElement & { requestVideoFrameCallback?: RVFC }
    ).requestVideoFrameCallback;
    if (rvfc) {
      const onFrame = () => {
        render();
        if (!stopped && videoRef.current) {
          (videoRef.current as HTMLVideoElement & { requestVideoFrameCallback: RVFC })
            .requestVideoFrameCallback(onFrame);
        }
      };
      rvfc.call(video, onFrame);
    }
    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
    };
  }, [useWebgl, render, src]);

  return (
    <div ref={containerRef} className={className} style={{ position: "relative", ...style }}>
      <video
        ref={videoRef}
        src={src}
        muted={muted}
        playsInline={playsInline}
        preload={preload}
        crossOrigin="anonymous"
        style={
          useWebgl
            ? { position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }
            : { ...FB_OBJECT_FIT, filter: fallbackFilter ?? "none" }
        }
      />
      <canvas
        ref={canvasRef}
        style={{
          ...FB_OBJECT_FIT,
          display: useWebgl ? "block" : "none",
        }}
      />
    </div>
  );
});

export default LUTVideo;

// ── GL plumbing ────────────────────────────────────────────────────────────

interface GLState {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  quad: WebGLBuffer;
  videoTex: WebGLTexture;
  lutClipTex: WebGLTexture;
  lutGlobalTex: WebGLTexture;
  uVideoLoc: WebGLUniformLocation | null;
  uLutClipLoc: WebGLUniformLocation | null;
  uLutGlobalLoc: WebGLUniformLocation | null;
  uClipEnabledLoc: WebGLUniformLocation | null;
  uGlobalEnabledLoc: WebGLUniformLocation | null;
  uLutSizeLoc: WebGLUniformLocation | null;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? "(no log)";
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log}`);
  }
  return sh;
}

function initGl(gl: WebGL2RenderingContext): GLState | null {
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, LUT_VERT_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, LUT_FRAG_SHADER);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`link failed: ${gl.getProgramInfoLog(program)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const videoTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    const lutClipTex = gl.createTexture()!;
    const lutGlobalTex = gl.createTexture()!;

    return {
      gl,
      program,
      vao,
      quad,
      videoTex,
      lutClipTex,
      lutGlobalTex,
      uVideoLoc: gl.getUniformLocation(program, "uVideo"),
      uLutClipLoc: gl.getUniformLocation(program, "uLutClip"),
      uLutGlobalLoc: gl.getUniformLocation(program, "uLutGlobal"),
      uClipEnabledLoc: gl.getUniformLocation(program, "uClipEnabled"),
      uGlobalEnabledLoc: gl.getUniformLocation(program, "uGlobalEnabled"),
      uLutSizeLoc: gl.getUniformLocation(program, "uLutSize"),
    };
  } catch (e) {
    console.error("[LUTVideo] GL init failed", e);
    return null;
  }
}

function upload3DLut(gl: WebGL2RenderingContext, tex: WebGLTexture, lut: CubeLut): void {
  gl.bindTexture(gl.TEXTURE_3D, tex);
  // Use RGB16F so trilinear is preserved precisely. (RGB8 introduces 1/255
  // banding which would defeat the pixel-match goal.)
  const N = lut.size;
  gl.texImage3D(
    gl.TEXTURE_3D,
    0,
    gl.RGB16F,
    N,
    N,
    N,
    0,
    gl.RGB,
    gl.FLOAT,
    lut.data,
  );
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_3D, null);
}
