import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronLeft,
  Clock,
  Download,
  Film,
  Image as ImageIcon,
  Layers,
  Loader2,
  Mic,
  Video,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import Button from "../components/ui/Button";
import type { GenerationEvent } from "../types";

type Stage = "pending" | "voice" | "image" | "video" | "done" | "error";

interface SceneProgress {
  stage: Stage;
  message: string;
  clip_path?: string;
}

const STAGE_LABEL: Record<Stage, string> = {
  pending: "대기",
  voice:   "음성 생성",
  image:   "이미지 생성",
  video:   "영상 생성",
  done:    "완료",
  error:   "실패",
};

const StageIcon = ({ stage, className = "w-3.5 h-3.5" }: { stage: Stage; className?: string }) => {
  if (stage === "done")  return <CheckCircle2 className={`${className} text-emerald-400`} />;
  if (stage === "error") return <XCircle     className={`${className} text-red-400`} />;
  if (stage === "voice") return <Mic         className={`${className} text-lipsync animate-pulse`} />;
  if (stage === "image") return <ImageIcon   className={`${className} text-loop animate-pulse`} />;
  if (stage === "video") return <Video       className={`${className} text-effect animate-pulse`} />;
  return <span className={`${className.replace(/w-\S+\s+h-\S+/, "w-3 h-3")} rounded-full border border-gray-600`} />;
};

export default function GenerationPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.projects.get(projectId!),
    enabled: !!projectId,
  });

  const { data: scenes = [] } = useQuery({
    queryKey: ["scenes", projectId],
    queryFn: () => api.scenes.list(projectId!),
    enabled: !!projectId,
  });

  const [running, setRunning]           = useState(false);
  const [outputPath, setOutputPath]     = useState<string | null>(null);
  const [logs, setLogs]                 = useState<string[]>([]);
  const [progress, setProgress]         = useState<SceneProgress[]>([]);
  const [startTime, setStartTime]       = useState<number | null>(null);
  const [now, setNow]                   = useState(Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const logBottomRef = useRef<HTMLDivElement>(null);

  // 경과 시간 / ETA 용 타이머
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    setProgress(scenes.map(() => ({ stage: "pending", message: "" })));
  }, [scenes]);

  const addLog = (msg: string) =>
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const doneCount = progress.filter((p) => p.stage === "done").length;
  const totalPct = scenes.length === 0 ? 0 : Math.round((doneCount / scenes.length) * 100);
  const elapsed = startTime ? Math.floor((now - startTime) / 1000) : 0;
  const etaSec = useMemo(() => {
    if (!startTime || doneCount === 0) return null;
    const perScene = (now - startTime) / doneCount / 1000;
    return Math.max(0, Math.round(perScene * (scenes.length - doneCount)));
  }, [startTime, doneCount, scenes.length, now]);

  const start = async () => {
    if (!projectId) return;
    setRunning(true);
    setLogs([]);
    setOutputPath(null);
    setStartTime(Date.now());
    addLog(`생성 시작 — 총 ${scenes.length}개 씬`);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
        signal: ctrl.signal,
      });
      if (!resp.ok || !resp.body) {
        addLog(`서버 오류: ${resp.status}`);
        setRunning(false);
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const ev: GenerationEvent = JSON.parse(line.slice(6));
          handleEvent(ev);
        }
      }
      setRunning(false);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        addLog(`연결 오류: ${(err as Error).message}`);
      }
      setRunning(false);
    }
  };

  const handleEvent = (ev: GenerationEvent) => {
    if (ev.type === "progress") {
      addLog(ev.message);
      if (ev.scene_index !== undefined && ev.stage) {
        const stage = ev.stage === "concat" ? "video" : (ev.stage as Stage);
        setProgress((prev) =>
          prev.map((p, i) =>
            i === ev.scene_index ? { ...p, stage, message: ev.message } : p
          )
        );
      }
    } else if (ev.type === "scene_done") {
      addLog(`씬 ${(ev.scene_index ?? 0) + 1} 완료`);
      setProgress((prev) =>
        prev.map((p, i) =>
          i === ev.scene_index ? { ...p, stage: "done", clip_path: ev.clip_path } : p
        )
      );
    } else if (ev.type === "complete") {
      addLog("🎬 최종 영상 생성 완료");
      setOutputPath(ev.output_path ?? null);
    } else if (ev.type === "error") {
      addLog(`❌ 오류: ${ev.message}`);
      setProgress((prev) =>
        prev.map((p) => (p.stage !== "done" ? { ...p, stage: "error" } : p))
      );
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
    addLog("중단됨");
  };

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to={`/projects/${projectId}`}
            className="flex items-center gap-1 text-gray-400 hover:text-white transition-colors text-sm flex-shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
            편집으로
          </Link>
          <span className="text-gray-600">/</span>
          <h1 className="font-semibold truncate">{project?.title ?? "..."} 생성</h1>
        </div>

        <div className="flex gap-2 flex-shrink-0">
          {running ? (
            <Button variant="danger" onClick={stop}>중단</Button>
          ) : (
            <Button variant="primary" disabled={scenes.length === 0} onClick={start}>
              <Film className="w-4 h-4" />
              {outputPath ? "다시 생성" : "생성 시작"}
            </Button>
          )}
        </div>
      </div>

      {scenes.length === 0 && (
        <div className="card bg-yellow-950/40 border-yellow-700/40 p-4 mb-4 text-sm text-yellow-300">
          씬이 없습니다.{" "}
          <Link to={`/projects/${projectId}`} className="underline">
            편집 화면
          </Link>
          에서 씬을 추가하세요.
        </div>
      )}

      {/* 전체 진행바 */}
      {scenes.length > 0 && (running || doneCount > 0 || outputPath) && (
        <div className="card p-4 mb-4 animate-fade-in">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              {doneCount} / {scenes.length} 씬
            </span>
            <span className="flex items-center gap-3 font-mono">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {fmtSec(elapsed)}
              </span>
              {etaSec !== null && running && <span>ETA ~{fmtSec(etaSec)}</span>}
              <span className="text-accent">{totalPct}%</span>
            </span>
          </div>
          <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-accent-hover to-accent transition-all duration-500"
              style={{ width: `${totalPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* 씬 진행 상태 */}
        <div className="lg:col-span-2 space-y-2">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">씬 진행</h2>
          {progress.map((p, i) => {
            const scene = scenes[i];
            const active = p.stage !== "pending" && p.stage !== "done" && p.stage !== "error";
            return (
              <div
                key={i}
                className={`card p-3 text-xs transition-all ${
                  p.stage === "done"
                    ? "border-emerald-500/40 bg-emerald-950/20"
                    : p.stage === "error"
                    ? "border-red-500/40 bg-red-950/20"
                    : active
                    ? "border-accent/40 bg-accent-muted"
                    : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  {active ? (
                    <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin text-accent" />
                  ) : (
                    <StageIcon stage={p.stage} />
                  )}
                  <span className="font-medium">
                    씬 {i + 1}
                    <span className="opacity-60 ml-1">
                      {scene?.type === "lipsync" ? "💬" : scene?.type === "loop" ? "🔄" : "✨"}
                    </span>
                  </span>
                  <span className="ml-auto opacity-60">{STAGE_LABEL[p.stage]}</span>
                </div>
                {p.message && (
                  <p className="mt-1 opacity-70 pl-5 truncate">{p.message}</p>
                )}
                {p.clip_path && (
                  <video
                    src={`/${p.clip_path}`}
                    controls
                    muted
                    className="mt-2 w-full rounded max-h-28 bg-black"
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* 로그 + 최종 출력 */}
        <div className="lg:col-span-3 space-y-4">
          {outputPath && (
            <div className="card p-4 animate-fade-in">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">최종 출력</h2>
                <a
                  href={`/${outputPath}`}
                  download
                  className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                >
                  <Download className="w-3 h-3" />
                  다운로드
                </a>
              </div>
              <video
                src={`/${outputPath}`}
                controls
                className="w-full rounded-lg bg-black aspect-video"
              />
            </div>
          )}

          <div className="card p-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">로그</h2>
            <div className="bg-surface-sunken rounded-lg p-3 h-64 overflow-y-auto font-mono text-[11px] text-gray-300 space-y-0.5">
              {logs.length === 0 ? (
                <span className="text-gray-600">
                  생성 시작 버튼을 누르면 로그가 표시됩니다.
                </span>
              ) : (
                logs.map((l, i) => <div key={i} className="whitespace-pre">{l}</div>)
              )}
              <div ref={logBottomRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtSec(s: number): string {
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}분 ${r}초`;
  const h = Math.floor(m / 60);
  return `${h}시간 ${m % 60}분`;
}
