/**
 * AudioGraph — Web Audio mixing engine for the composer.
 *
 *   element  → MediaElementAudioSourceNode → elementGain → trackGain → masterGain → destination
 *                                                                              └─→ trackAnalyser  (level meter)
 *
 * Lifetime:
 *   - Lazy AudioContext on first request (browser autoplay policy keeps it
 *     suspended until ensureRunning() inside a user gesture).
 *   - Element registration is permanent for the element's lifetime; an element
 *     can be routed exactly once (Web Audio spec).
 *   - Track gains, analysers, and master gain live for the full session.
 */

export type TrackKind = "voice" | "sfx" | "bgm";

const TRACKS: TrackKind[] = ["voice", "sfx", "bgm"];

interface ElementRoute {
  source: MediaElementAudioSourceNode;
  elementGain: GainNode;
  kind: TrackKind;
}

export interface TrackState {
  volume: number;     // 0..2 (gain)
  mute: boolean;
  solo: boolean;
}

type Listener = () => void;

export class AudioGraph {
  private static _instance: AudioGraph | null = null;
  static get instance(): AudioGraph {
    if (!this._instance) this._instance = new AudioGraph();
    return this._instance;
  }

  private _ctx: AudioContext | null = null;
  private _master: GainNode | null = null;
  private _trackGains: Record<TrackKind, GainNode> | null = null;
  private _trackAnalysers: Record<TrackKind, AnalyserNode> | null = null;
  private _routes = new Map<HTMLMediaElement, ElementRoute>();
  private _state: Record<TrackKind, TrackState> = {
    voice: { volume: 1.0, mute: false, solo: false },
    sfx:   { volume: 1.0, mute: false, solo: false },
    bgm:   { volume: 0.5, mute: false, solo: false },
  };
  private _listeners = new Set<Listener>();

  private constructor() {
    /* lazy init in _init() */
  }

  private _init() {
    if (this._ctx) return;
    const Ctor: typeof AudioContext =
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? AudioContext;
    this._ctx = new Ctor();
    this._master = this._ctx.createGain();
    this._master.gain.value = 1.0;
    this._master.connect(this._ctx.destination);
    const make = (): GainNode => {
      const g = this._ctx!.createGain();
      g.gain.value = 1.0;
      return g;
    };
    this._trackGains = { voice: make(), sfx: make(), bgm: make() };
    const makeA = (): AnalyserNode => {
      const a = this._ctx!.createAnalyser();
      a.fftSize = 1024;
      a.smoothingTimeConstant = 0.6;
      return a;
    };
    this._trackAnalysers = { voice: makeA(), sfx: makeA(), bgm: makeA() };
    for (const k of TRACKS) {
      // Track gain → both master and analyser (analyser is a tap, no audio leak).
      this._trackGains[k].connect(this._master);
      this._trackGains[k].connect(this._trackAnalysers[k]);
    }
    this._applyState();
  }

  /** Resume after user gesture. Must be called from a real user event. */
  async ensureRunning(): Promise<void> {
    this._init();
    if (this._ctx!.state === "suspended") {
      try {
        await this._ctx!.resume();
      } catch {
        /* ignore; will retry on next user event */
      }
    }
  }

  get context(): AudioContext | null {
    return this._ctx;
  }

  /** Route an element through the graph. Idempotent for the same element/kind. */
  routeElement(el: HTMLMediaElement, kind: TrackKind): GainNode {
    this._init();
    const existing = this._routes.get(el);
    if (existing) {
      // Re-route to a new track if needed: disconnect old elementGain → trackGain
      // and reconnect.
      if (existing.kind !== kind) {
        existing.elementGain.disconnect();
        existing.elementGain.connect(this._trackGains![kind]);
        existing.kind = kind;
      }
      return existing.elementGain;
    }
    let source: MediaElementAudioSourceNode;
    try {
      source = this._ctx!.createMediaElementSource(el);
    } catch (e) {
      // Already routed elsewhere or in an invalid state. Some browsers throw
      // if the element was already passed to another AudioContext. The
      // safest path is to bail and let element.volume control playback —
      // useClipSync handles this fallback because we return null then.
      throw new Error(`createMediaElementSource failed: ${(e as Error).message}`);
    }
    const elementGain = this._ctx!.createGain();
    elementGain.gain.value = 1.0;
    source.connect(elementGain);
    elementGain.connect(this._trackGains![kind]);
    const route: ElementRoute = { source, elementGain, kind };
    this._routes.set(el, route);
    return elementGain;
  }

  /** Stop tracking an element. Disconnects its gain (source can't be deleted in Web Audio). */
  unrouteElement(el: HTMLMediaElement) {
    const route = this._routes.get(el);
    if (!route) return;
    route.elementGain.disconnect();
    this._routes.delete(el);
  }

  /** Set a registered element's gain (clip-level volume). Optional ramp. */
  setElementGain(el: HTMLMediaElement, value: number, rampSec = 0.02) {
    const route = this._routes.get(el);
    if (!route || !this._ctx) return;
    const t = this._ctx.currentTime;
    route.elementGain.gain.cancelScheduledValues(t);
    if (rampSec > 0) {
      route.elementGain.gain.setValueAtTime(route.elementGain.gain.value, t);
      route.elementGain.gain.linearRampToValueAtTime(Math.max(0, value), t + rampSec);
    } else {
      route.elementGain.gain.setValueAtTime(Math.max(0, value), t);
    }
  }

  isRouted(el: HTMLMediaElement): boolean {
    return this._routes.has(el);
  }

  // ── Track-level controls ──────────────────────────────────────────────

  getTrackState(kind: TrackKind): TrackState {
    return this._state[kind];
  }

  setTrackVolume(kind: TrackKind, volume: number) {
    this._state[kind] = { ...this._state[kind], volume };
    this._applyState();
    this._notify();
  }

  setTrackMute(kind: TrackKind, mute: boolean) {
    this._state[kind] = { ...this._state[kind], mute };
    this._applyState();
    this._notify();
  }

  setTrackSolo(kind: TrackKind, solo: boolean) {
    this._state[kind] = { ...this._state[kind], solo };
    this._applyState();
    this._notify();
  }

  /** Compute effective gain for each track and push to GainNode.gain. */
  private _applyState() {
    if (!this._ctx || !this._trackGains) return;
    const anySolo = TRACKS.some((k) => this._state[k].solo);
    for (const kind of TRACKS) {
      const s = this._state[kind];
      const audible = anySolo ? s.solo : !s.mute;
      const target = audible ? Math.max(0, s.volume) : 0;
      const t = this._ctx.currentTime;
      const g = this._trackGains[kind].gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(target, t + 0.04);
    }
  }

  // ── Subscriptions (React UI) ─────────────────────────────────────────

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private _notify() {
    this._listeners.forEach((l) => l());
  }

  // ── Analyser tap for level meter ──────────────────────────────────────

  getAnalyser(kind: TrackKind): AnalyserNode | null {
    this._init();
    return this._trackAnalysers ? this._trackAnalysers[kind] : null;
  }
}

export const audioGraph = AudioGraph.instance;
