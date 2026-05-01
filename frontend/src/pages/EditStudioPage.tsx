import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import TimelineComposer from "../components/video/TimelineComposer";

export default function EditStudioPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.projects.get(projectId!),
    enabled: !!projectId,
  });

  if (isLoading) {
    return <div className="text-gray-400 text-sm py-6 container mx-auto max-w-6xl">불러오는 중...</div>;
  }
  if (!project || !projectId) {
    return (
      <div className="text-center py-20 text-gray-500 container mx-auto max-w-6xl">
        <p>프로젝트를 찾을 수 없습니다.</p>
        <Link to="/" className="text-accent text-sm mt-2 inline-block hover:underline">
          목록으로
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to={`/projects/${projectId}`}
            className="flex items-center gap-1 text-gray-400 hover:text-white transition-colors text-sm flex-shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
            편집기로
          </Link>
          <span className="text-gray-600">/</span>
          <h1 className="font-semibold truncate">{project.title} · 편집 스튜디오</h1>
        </div>
      </div>
      <TimelineComposer projectId={projectId} />
    </div>
  );
}
