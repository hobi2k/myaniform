import { Image as ImageIcon, Mic, Play, Scissors, User, Video } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import type { Character, Project, Scene } from "../../types";
import Button from "../ui/Button";

interface Props {
  project: Project;
  characters: Character[];
  scenes: Scene[];
  projectId: string;
}

export default function PipelineStatusBar({ project, characters, scenes, projectId }: Props) {
  const navigate = useNavigate();

  const charsWithSprite = characters.filter((c) => !!c.sprite_path).length;
  const scenesWithVoice = scenes.filter((s) => !!s.voice_path).length;
  const scenesWithImage = scenes.filter((s) => !!s.image_path).length;
  const scenesWithVideo = scenes.filter((s) => !!s.clip_path && !s.clip_stale).length;

  return (
    <div className="rounded-xl border border-white/10 bg-surface-overlay/40 px-4 py-2 flex items-center gap-3 flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Link to="/" className="text-gray-500 hover:text-white transition-colors text-xs flex-shrink-0">
          프로젝트
        </Link>
        <span className="text-gray-600 text-xs">/</span>
        <h1 className="font-semibold text-white truncate text-sm">{project.title}</h1>
        {project.episode && (
          <span className="text-[10px] text-gray-300 bg-surface-overlay px-2 py-0.5 rounded-full border border-white/5 flex-shrink-0">
            {project.episode}
          </span>
        )}
      </div>

      <div className="flex-1" />

      <div className="hidden md:flex items-center gap-3 text-[11px]">
        <Counter icon={<User className="w-3 h-3" />} label="캐릭터" total={characters.length} done={charsWithSprite} doneLabel="스프라이트" />
        <span className="text-gray-700">·</span>
        <Counter icon={<Mic className="w-3 h-3" />} label="음성" total={scenes.filter((s) => !!s.dialogue).length} done={scenesWithVoice} />
        <Counter icon={<ImageIcon className="w-3 h-3" />} label="장면샷" total={scenes.length} done={scenesWithImage} />
        <Counter icon={<Video className="w-3 h-3" />} label="영상" total={scenes.length} done={scenesWithVideo} />
      </div>

      <Button size="sm" variant="secondary" onClick={() => navigate(`/projects/${projectId}/generate`)}>
        <Play className="w-3.5 h-3.5" />
        일괄 생성
      </Button>
      <Button size="sm" variant="primary" onClick={() => navigate(`/projects/${projectId}/edit-studio`)}>
        <Scissors className="w-3.5 h-3.5" />
        편집 스튜디오
      </Button>
    </div>
  );
}

function Counter({
  icon,
  label,
  total,
  done,
  doneLabel,
}: {
  icon: React.ReactNode;
  label: string;
  total: number;
  done: number;
  doneLabel?: string;
}) {
  const tone = total === 0 ? "text-gray-600" : done >= total ? "text-emerald-300" : "text-gray-300";
  return (
    <span className={`flex items-center gap-1 ${tone}`} title={doneLabel ? `${doneLabel} ${done}/${total}` : `${label} ${done}/${total}`}>
      {icon}
      <span className="text-gray-500">{label}</span>
      <span className="font-mono">{done}/{total}</span>
    </span>
  );
}
