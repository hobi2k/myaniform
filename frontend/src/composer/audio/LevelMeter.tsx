import { useEffect, useRef } from "react";
import { audioGraph, type TrackKind } from "./AudioGraph";

interface Props {
  kind: TrackKind;
  /** Render only when player is active (saves RAF cycles). */
  active: boolean;
}

/**
 * Real-time RMS + peak meter rendered into a small canvas. Reads
 * float time-domain samples from the track's AnalyserNode each frame.
 *
 * The bar fills proportional to RMS dBFS (clamped to -60..0). A short red
 * tick at the right shows recent peak, decaying over ~600ms.
 */
export default function LevelMeter({ kind, active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peakRef = useRef<{ value: number; lastUpdate: number }>({ value: -60, lastUpdate: 0 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv) return;
    const ctx2d = cnv.getContext("2d");
    if (!ctx2d) return;
    const analyser = audioGraph.getAnalyser(kind);
    if (!analyser) return;

    // Allocate buffer matching analyser FFT size.
    const buf = new Float32Array(analyser.fftSize);

    const draw = (now: number) => {
      const w = cnv.width;
      const h = cnv.height;
      ctx2d.clearRect(0, 0, w, h);

      // Background.
      ctx2d.fillStyle = "rgba(255,255,255,0.05)";
      ctx2d.fillRect(0, 0, w, h);

      let rmsDb = -60;
      if (active) {
        try {
          analyser.getFloatTimeDomainData(buf);
          let sumSq = 0;
          for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
          const rms = Math.sqrt(sumSq / buf.length);
          rmsDb = rms > 1e-6 ? 20 * Math.log10(rms) : -60;
        } catch {
          rmsDb = -60;
        }
      }

      // Peak hold (decay).
      const peak = peakRef.current;
      if (rmsDb > peak.value) {
        peak.value = rmsDb;
        peak.lastUpdate = now;
      } else if (now - peak.lastUpdate > 600) {
        peak.value = Math.max(-60, peak.value - 0.4); // decay
      }

      // Map dB → x.
      const dbToX = (db: number): number => {
        const norm = Math.max(0, Math.min(1, (db + 60) / 60));
        return norm * w;
      };
      const rmsX = dbToX(rmsDb);
      const peakX = dbToX(peak.value);

      // Bar: green → yellow → red gradient.
      const grad = ctx2d.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "#10b981");
      grad.addColorStop(0.65, "#fbbf24");
      grad.addColorStop(0.95, "#ef4444");
      ctx2d.fillStyle = grad;
      ctx2d.fillRect(0, 0, rmsX, h);

      // Peak tick.
      ctx2d.fillStyle = "#fff";
      ctx2d.fillRect(Math.max(0, peakX - 2), 0, 2, h);

      // -6dB / -12dB hash marks.
      ctx2d.strokeStyle = "rgba(255,255,255,0.2)";
      ctx2d.beginPath();
      for (const db of [-6, -12, -18, -24]) {
        const x = dbToX(db);
        ctx2d.moveTo(x, 0);
        ctx2d.lineTo(x, h);
      }
      ctx2d.stroke();

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [kind, active]);

  return (
    <canvas
      ref={canvasRef}
      width={140}
      height={8}
      className="rounded-sm"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
