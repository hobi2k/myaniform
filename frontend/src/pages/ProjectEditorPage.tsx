import { useQuery } from "@tanstack/react-query";
import { Clapperboard, Layers3, Play, User } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import CharacterPanel from "../components/character/CharacterPanel";
import SceneEditor from "../components/scene/SceneEditor";
import Button from "../components/ui/Button";
import TimelineComposer from "../components/video/TimelineComposer";

type Tab = "characters" | "scenes" | "composer";

export default function ProjectEditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("characters");

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.projects.get(projectId!),
    enabled: !!projectId,
  });

  if (isLoading) {
    return <div className="text-gray-400 text-sm">불러오는 중...</div>;
  }

  if (!project || !projectId) {
    return (
      <div className="text-center py-20 text-gray-500">
        <p>프로젝트를 찾을 수 없습니다.</p>
        <Link to="/" className="text-accent text-sm mt-2 inline-block hover:underline">
          목록으로
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)] animate-fade-in">
      {/* 상단 헤더 */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/" className="text-gray-500 hover:text-white transition-colors text-sm flex-shrink-0">
            프로젝트
          </Link>
          <span className="text-gray-600">/</span>
          <h1 className="font-semibold text-white truncate">{project.title}</h1>
          {project.episode && (
            <span className="text-[11px] text-gray-300 bg-surface-overlay px-2 py-0.5 rounded-full border border-white/5 flex-shrink-0">
              {project.episode}
            </span>
          )}
        </div>

        <Button
          variant="primary"
          onClick={() => navigate(`/projects/${projectId}/generate`)}
        >
          <Play className="w-4 h-4" />
          생성 시작
        </Button>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-4 flex-shrink-0 border-b border-white/10">
        {([
          { key: "characters", label: "캐릭터", icon: User },
          { key: "scenes",     label: "씬 편집", icon: Clapperboard },
          { key: "composer",   label: "타임라인", icon: Layers3 },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-all -mb-px ${
              tab === key
                ? "border-accent text-accent"
                : "border-transparent text-gray-400 hover:text-white hover:border-white/10"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === "characters" && <CharacterPanel projectId={projectId} />}
        {tab === "scenes" && <SceneEditor projectId={projectId} />}
        {tab === "composer" && <TimelineComposer projectId={projectId} />}
      </div>
    </div>
  );
}
