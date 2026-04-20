import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

// scene.type → 워크플로우 매핑 (backend/routers/workflows.py 와 동기)
const SCENE_TYPE_WORKFLOW: Record<string, string> = {
  lipsync: "ws_lipsync",
  loop:    "ws_loop",
  effect:  "ws_effect",
};

// 선택 드롭다운용 전체 리스트
const ALL_WORKFLOWS: { name: string; label: string; group: string }[] = [
  { name: "ws_lipsync",       label: "립싱크 (S2V)",        group: "씬" },
  { name: "ws_loop",          label: "루프 (I2V 2-stage)",  group: "씬" },
  { name: "ws_effect",        label: "이펙트 (I2V 2-stage)",group: "씬" },
  { name: "ws_scene_keyframe",label: "씬 키프레임",         group: "씬" },
  { name: "ws_char_create",   label: "캐릭터 생성",         group: "캐릭터" },
  { name: "ws_char_clone",    label: "캐릭터 클론",         group: "캐릭터" },
  { name: "ws_tts_clone",     label: "TTS 클론 (Qwen3)",    group: "TTS" },
  { name: "ws_tts_s2pro",     label: "TTS S2 Pro (Fish)",   group: "TTS" },
  { name: "ws_voice_design",  label: "보이스 디자인",       group: "TTS" },
  { name: "ws_concat",        label: "영상 concat",         group: "Post" },
];

const COMFYUI = "http://127.0.0.1:8188";

export default function WorkflowViewerPage() {
  const [params, setParams] = useSearchParams();

  const initial = useMemo(() => {
    const raw = params.get("workflow") ?? params.get("type");
    if (!raw) return "ws_loop";
    return SCENE_TYPE_WORKFLOW[raw] ?? raw;
  }, [params]);

  const [current, setCurrent] = useState(initial);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeReadyRef = useRef(false);

  // iframe src 는 한 번만 설정 — 이후 전환은 postMessage 로
  const iframeSrc = useMemo(
    () => `${COMFYUI}/?workflow=${encodeURIComponent(initial)}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [], // 마운트 시 고정
  );

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (ev.data?.type === "myaniform:ready") {
        iframeReadyRef.current = true;
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // current 변경 시 iframe 에 전환 메시지
  useEffect(() => {
    if (!iframeReadyRef.current) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "myaniform:load", workflow: current },
      COMFYUI,
    );
    setParams({ workflow: current }, { replace: true });
  }, [current, setParams]);

  return (
    <div className="fixed inset-0 flex flex-col bg-bg">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 bg-surface-raised/60">
        <Link to="/" className="p-1.5 hover:bg-white/5 rounded transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <span className="text-xs text-gray-400 uppercase tracking-wider">워크플로우</span>
        <select
          className="input-base text-sm"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        >
          {["씬", "캐릭터", "TTS", "Post"].map((g) => (
            <optgroup key={g} label={g}>
              {ALL_WORKFLOWS.filter((w) => w.group === g).map((w) => (
                <option key={w.name} value={w.name}>
                  {w.label} ({w.name})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="flex-1" />
        <a
          href={`${COMFYUI}/?workflow=${encodeURIComponent(current)}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-gray-500 hover:text-accent transition-colors"
        >
          새 창에서 열기 ↗
        </a>
      </div>
      <iframe
        ref={iframeRef}
        src={iframeSrc}
        title="ComfyUI"
        className="flex-1 w-full border-0"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
