import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { comfyUiUrl } from "../utils/hosts";

// scene.type → 워크플로우 매핑 (backend/routers/workflows.py 와 동기)
const SCENE_TYPE_WORKFLOW: Record<string, string> = {
  lipsync: "s2v_fastfidelity_original",
  loop:    "video_loop_original",
  effect:  "video_effect_original",
};

// 선택 드롭다운용 전체 리스트
const ALL_WORKFLOWS: { name: string; label: string; group: string }[] = [
  { name: "scene_image_original", label: "장면 이미지 원본", group: "이미지 원본" },
  { name: "character_sprite_new_original", label: "신규 스프라이트 원본", group: "캐릭터 원본" },
  { name: "character_sprite_reference_original", label: "참조 스프라이트 원본", group: "캐릭터 원본" },
  { name: "video_loop_original",   label: "루프 원본 (동영상 루프)",        group: "영상 원본" },
  { name: "video_effect_original", label: "첫끝프레임 원본",              group: "영상 원본" },
  { name: "s2v_fastfidelity_original", label: "립싱크 원본 (S2V FastFidelity)", group: "영상 원본" },
  { name: "ws_tts_clone",     label: "TTS 클론 (Qwen3)",    group: "TTS" },
  { name: "ws_tts_s2pro",     label: "TTS S2 Pro (Fish)",   group: "TTS" },
  { name: "ws_voice_design",  label: "보이스 디자인",       group: "TTS" },
];

export default function WorkflowViewerPage() {
  const [params, setParams] = useSearchParams();
  const { data: comfyStatus, isLoading: comfyStatusLoading } = useQuery({
    queryKey: ["comfy-status"],
    queryFn: () => api.setup.comfyStatus(),
    refetchInterval: 5000,
  });

  const initial = useMemo(() => {
    const raw = params.get("workflow") ?? params.get("type");
    if (!raw) return "video_loop_original";
    return SCENE_TYPE_WORKFLOW[raw] ?? raw;
  }, [params]);

  const [current, setCurrent] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const [iframeMessage, setIframeMessage] = useState("");
  const comfyUrl = useMemo(() => comfyUiUrl(), []);
  const iframeSrc = useMemo(
    () => `${comfyUrl}/?workflow=${encodeURIComponent(current)}`,
    [comfyUrl, current],
  );

  useEffect(() => {
    setParams({ workflow: current }, { replace: true });
    setLoading(true);
    setTimedOut(false);
    const timer = window.setTimeout(() => setTimedOut(true), 5000);
    return () => window.clearTimeout(timer);
  }, [current, setParams]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "myaniform:ready") {
        setIframeMessage("ComfyUI 확장 연결됨");
      } else if (msg.type === "myaniform:loaded") {
        setIframeMessage(`${msg.workflow} 로드 완료`);
        setLoading(false);
        setTimedOut(false);
      } else if (msg.type === "myaniform:error") {
        setIframeMessage(msg.message ?? "워크플로우 로드 실패");
        setTimedOut(true);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

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
          {["영상 원본", "씬", "캐릭터", "TTS", "Post"].map((g) => (
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
          href={`${comfyUrl}/?workflow=${encodeURIComponent(current)}`}
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
                href={comfyUrl}
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
                <p className="text-xs text-red-300 mt-3 break-all">
                  {iframeMessage || "로딩이 지연되고 있습니다. 새 창에서 열기를 눌러 브라우저 접근 주소를 확인하세요."}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
