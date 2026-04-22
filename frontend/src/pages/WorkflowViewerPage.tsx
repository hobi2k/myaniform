import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";

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
  { name: "ws_tts_clone",     label: "TTS 클론 (Qwen3)",    group: "TTS" },
  { name: "ws_tts_s2pro",     label: "TTS S2 Pro (Fish)",   group: "TTS" },
  { name: "ws_voice_design",  label: "보이스 디자인",       group: "TTS" },
  { name: "ws_concat",        label: "영상 concat",         group: "Post" },
];

const COMFYUI = "http://127.0.0.1:8188";

export default function WorkflowViewerPage() {
  const [params, setParams] = useSearchParams();
  const { data: comfyStatus, isLoading: comfyStatusLoading } = useQuery({
    queryKey: ["comfy-status"],
    queryFn: () => api.setup.comfyStatus(),
    refetchInterval: 5000,
  });

  const initial = useMemo(() => {
    const raw = params.get("workflow") ?? params.get("type");
    if (!raw) return "ws_loop";
    return SCENE_TYPE_WORKFLOW[raw] ?? raw;
  }, [params]);

  const [current, setCurrent] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const iframeSrc = useMemo(
    () => `${COMFYUI}/?workflow=${encodeURIComponent(current)}`,
    [current],
  );

  useEffect(() => {
    setParams({ workflow: current }, { replace: true });
    setLoading(true);
    setTimedOut(false);
    const timer = window.setTimeout(() => setTimedOut(true), 5000);
    return () => window.clearTimeout(timer);
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
      <div className="relative flex-1">
        {comfyStatus?.online && (
          <iframe
            src={iframeSrc}
            title="ComfyUI"
            className="flex-1 w-full h-full border-0"
            allow="clipboard-read; clipboard-write"
            onLoad={() => {
              setLoading(false);
              setTimedOut(false);
            }}
          />
        )}
        {(!comfyStatus?.online && !comfyStatusLoading) ? (
          <div className="absolute inset-0 grid place-items-center bg-bg/92">
            <div className="max-w-lg rounded-2xl border border-red-500/30 bg-surface-raised/95 p-6 text-center shadow-card">
              <p className="text-base font-semibold text-white mb-2">ComfyUI가 현재 열려 있지 않습니다</p>
              <p className="text-sm text-gray-400 mb-3">
                그래서 상단 `워크플로우` 버튼을 눌러도 iframe 안에 아무 것도 뜨지 않습니다.
              </p>
              <p className="text-xs text-red-300 break-all">
                {comfyStatus?.detail ?? "127.0.0.1:8188 연결 실패"}
              </p>
              <a
                href={COMFYUI}
                target="_self"
                rel="noreferrer"
                className="inline-flex mt-4 text-sm text-accent hover:underline"
              >
                ComfyUI 주소로 이동
              </a>
            </div>
          </div>
        ) : loading && comfyStatus?.online && (
          <div className="absolute inset-0 grid place-items-center bg-bg/85 backdrop-blur-sm">
            <div className="max-w-md rounded-2xl border border-white/10 bg-surface-raised/90 p-5 text-center shadow-card">
              <p className="text-sm font-medium text-white mb-1">워크플로우 로딩 중</p>
              <p className="text-xs text-gray-400">
                ComfyUI iframe 이 열리면 여기서 바로 워크플로우를 확인할 수 있습니다.
              </p>
              {timedOut && (
                <p className="text-xs text-red-300 mt-3">
                  로딩이 지연되고 있습니다. ComfyUI 서버가 꺼져 있으면 iframe 이 비어 보일 수 있습니다.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
