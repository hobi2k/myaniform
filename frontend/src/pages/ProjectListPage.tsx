import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Film, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import Button from "../components/ui/Button";
import type { Project } from "../types";

const STATUS_META: Record<Project["status"], { dot: string; label: string }> = {
  idle:      { dot: "bg-gray-500",                   label: "대기" },
  running:   { dot: "bg-yellow-400 animate-pulse",   label: "생성 중" },
  completed: { dot: "bg-emerald-400",                label: "완료" },
  failed:    { dot: "bg-red-500",                    label: "실패" },
};

export default function ProjectListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list,
  });

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [episode, setEpisode] = useState("");

  const createMutation = useMutation({
    mutationFn: () => api.projects.create({ title, episode: episode || undefined }),
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${project.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.projects.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">프로젝트</h1>
          <p className="text-xs text-gray-500 mt-1">
            에피소드 단위로 캐릭터·씬을 묶어 한 편의 영상으로 생성합니다.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" />
          새 프로젝트
        </Button>
      </div>

      {showForm && (
        <div className="card p-5 mb-6 animate-fade-in">
          <h2 className="font-semibold mb-4">새 프로젝트 만들기</h2>
          <div className="flex gap-3 flex-wrap">
            <input
              className="input-base flex-1 min-w-60 text-sm py-2.5"
              placeholder="제목 (예: 봄날의 벚꽃공원)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) createMutation.mutate();
              }}
            />
            <input
              className="input-base w-32 text-sm py-2.5"
              placeholder="EP1"
              value={episode}
              onChange={(e) => setEpisode(e.target.value)}
            />
            <Button
              variant="primary"
              loading={createMutation.isPending}
              disabled={!title.trim()}
              onClick={() => createMutation.mutate()}
            >
              생성
            </Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>취소</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card p-4 h-40 shimmer" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="card text-center py-20 text-gray-500">
          <Film className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>프로젝트가 없습니다.</p>
          <p className="text-sm mt-1">오른쪽 위 버튼으로 첫 프로젝트를 만들어보세요.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onOpen={() => navigate(`/projects/${p.id}`)}
              onDelete={() => {
                if (confirm(`"${p.title}" 을(를) 삭제하시겠습니까?`)) {
                  deleteMutation.mutate(p.id);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  onOpen,
  onDelete,
}: {
  project: Project;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const meta = STATUS_META[project.status];

  return (
    <div
      className="card card-hover group cursor-pointer overflow-hidden animate-fade-in"
      onClick={onOpen}
    >
      {/* 미리보기 */}
      <div className="aspect-video bg-surface-sunken relative overflow-hidden">
        {project.output_path ? (
          <video
            src={`/${project.output_path}`}
            className="w-full h-full object-cover"
            muted
            playsInline
            preload="metadata"
            onMouseEnter={(e) => e.currentTarget.play()}
            onMouseLeave={(e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0;
            }}
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-gray-700">
            <Film className="w-10 h-10" />
          </div>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/50 backdrop-blur-sm px-2 py-1 rounded-md text-[10px] text-white">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </div>
      </div>

      {/* 본문 */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="min-w-0">
            <div className="font-semibold text-white truncate">{project.title}</div>
            {project.episode && (
              <div className="text-xs text-gray-400 mt-0.5">{project.episode}</div>
            )}
          </div>
          <button
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <div className="text-[10px] text-gray-500">
          {new Date(project.created_at).toLocaleString("ko-KR", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}
