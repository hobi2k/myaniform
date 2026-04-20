import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image as ImageIcon, Layers, Mic, Plus, Trash2, Upload, User, Wand2 } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../../api";
import type { Character } from "../../types";
import Button from "../ui/Button";

interface Props {
  projectId: string;
}

export default function CharacterPanel({ projectId }: Props) {
  const qc = useQueryClient();
  const { data: characters = [] } = useQuery({
    queryKey: ["characters", projectId],
    queryFn: () => api.characters.list(projectId),
  });

  const [selected, setSelected] = useState<Character | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");

  const createMutation = useMutation({
    mutationFn: () => api.characters.create(projectId, { name: newName }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["characters", projectId] });
      setSelected(c);
      setShowNew(false);
      setNewName("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.characters.delete(projectId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["characters", projectId] });
      setSelected(null);
    },
  });

  return (
    <div className="flex gap-4 h-full">
      {/* 캐릭터 목록 */}
      <div className="w-48 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            캐릭터 ({characters.length})
          </span>
          <button
            onClick={() => setShowNew(true)}
            className="w-7 h-7 rounded-lg hover:bg-white/10 text-gray-300 hover:text-accent transition-colors flex items-center justify-center"
            title="캐릭터 추가"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {showNew && (
          <div className="mb-2 animate-fade-in">
            <input
              autoFocus
              className="input-base w-full"
              placeholder="이름"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) createMutation.mutate();
                if (e.key === "Escape") setShowNew(false);
              }}
            />
          </div>
        )}

        <div className="space-y-1">
          {characters.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className={`w-full text-left px-2 py-2 rounded-lg text-xs transition-all flex items-center gap-2 border ${
                selected?.id === c.id
                  ? "bg-accent-muted border-accent/40 text-white"
                  : "border-transparent hover:bg-white/5 hover:border-white/10 text-gray-300"
              }`}
            >
              {c.image_path ? (
                <img
                  src={`/${c.image_path}`}
                  className="w-7 h-7 rounded-full object-cover ring-1 ring-white/10 flex-shrink-0"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-surface-overlay grid place-items-center flex-shrink-0">
                  <User className="w-3.5 h-3.5 opacity-50" />
                </div>
              )}
              <span className="flex-1 truncate">{c.name}</span>
              {c.voice_sample_path && (
                <Mic className="w-3 h-3 text-emerald-400/80 flex-shrink-0" />
              )}
            </button>
          ))}

          {characters.length === 0 && !showNew && (
            <div className="text-xs text-gray-600 px-2 py-6 text-center border border-dashed border-white/10 rounded-lg">
              캐릭터를 추가하세요
            </div>
          )}
        </div>
      </div>

      {/* 캐릭터 상세 편집 */}
      <div className="flex-1 min-w-0">
        {selected ? (
          <CharacterEditor
            key={selected.id}
            character={selected}
            projectId={projectId}
            onUpdated={(c) => {
              setSelected(c);
              qc.invalidateQueries({ queryKey: ["characters", projectId] });
            }}
            onDelete={() => deleteMutation.mutate(selected.id)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            캐릭터를 선택하거나 새로 만드세요.
          </div>
        )}
      </div>
    </div>
  );
}


function CharacterEditor({
  character,
  projectId,
  onUpdated,
  onDelete,
}: {
  character: Character;
  projectId: string;
  onUpdated: (c: Character) => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);

  const [desc, setDesc] = useState(character.description ?? "");
  const [voiceDesign, setVoiceDesign] = useState(character.voice_design ?? "");

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Character>) =>
      api.characters.update(projectId, character.id, data),
    onSuccess: onUpdated,
  });

  const generateImageMutation = useMutation({
    mutationFn: () => {
      // description 먼저 저장 후 생성
      return api.characters
        .update(projectId, character.id, { description: desc })
        .then(() => api.characters.generateImage(projectId, character.id));
    },
    onSuccess: onUpdated,
  });

  const uploadImageMutation = useMutation({
    mutationFn: (file: File) => api.characters.uploadImage(projectId, character.id, file),
    onSuccess: onUpdated,
  });

  // Phase 4: VNCCS 시트 / 스프라이트
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const spriteInputRef = useRef<HTMLInputElement>(null);
  const generateSheetMutation = useMutation({
    mutationFn: () =>
      api.characters
        .update(projectId, character.id, { description: desc })
        .then(() => api.characters.generateSheet(projectId, character.id)),
    onSuccess: onUpdated,
  });
  const uploadSheetMutation = useMutation({
    mutationFn: (file: File) => api.characters.uploadSheet(projectId, character.id, file),
    onSuccess: onUpdated,
  });
  const uploadSpriteMutation = useMutation({
    mutationFn: (file: File) => api.characters.uploadSprite(projectId, character.id, file),
    onSuccess: onUpdated,
  });

  const designVoiceMutation = useMutation({
    mutationFn: () => api.characters.designVoice(projectId, character.id, voiceDesign),
    onSuccess: onUpdated,
  });

  const uploadVoiceMutation = useMutation({
    mutationFn: (file: File) => api.characters.uploadVoice(projectId, character.id, file),
    onSuccess: onUpdated,
  });

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">{character.name}</h3>
        <button onClick={onDelete} className="p-1.5 hover:text-red-400 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* 이미지 섹션 */}
      <div>
        <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wider">캐릭터 이미지</p>
        <div className="flex gap-3 items-start">
          <div className="w-24 h-24 bg-surface-overlay rounded-xl overflow-hidden flex-shrink-0 border border-white/10 shadow-card">
            {character.image_path ? (
              <img src={`/${character.image_path}`} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <User className="w-8 h-8 text-gray-600" />
              </div>
            )}
          </div>
          <div className="flex-1 space-y-2 min-w-0">
            <textarea
              className="input-base w-full resize-none h-16"
              placeholder="1girl, brown hair, bob cut, 30s, gentle expression, anime style..."
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                loading={generateImageMutation.isPending}
                disabled={!desc.trim()}
                onClick={() => generateImageMutation.mutate()}
              >
                <Wand2 className="w-3 h-3" />
                AI 생성
              </Button>
              <Button size="sm" onClick={() => imageInputRef.current?.click()}>
                <Upload className="w-3 h-3" />
                업로드
              </Button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadImageMutation.mutate(file);
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Phase 4: VNCCS 시트 / 스프라이트 섹션 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-3 h-3" />
            캐릭터 시트 / 스프라이트 (VNCCS)
          </p>
          <a
            href="/workflows?workflow=vnccs_step1_sheet_ui"
            target="_blank"
            className="text-[10px] text-accent hover:underline"
          >
            전체 VNCCS 파이프라인 →
          </a>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* 시트 */}
          <div className="bg-surface-overlay/40 rounded-xl p-2 border border-white/10">
            <div className="aspect-[3/2] bg-surface-overlay rounded-lg overflow-hidden flex items-center justify-center mb-2">
              {character.sheet_path ? (
                <img src={`/${character.sheet_path}`} className="w-full h-full object-contain" />
              ) : (
                <ImageIcon className="w-6 h-6 text-gray-600" />
              )}
            </div>
            <p className="text-[10px] text-gray-500 mb-1.5">턴어라운드 시트</p>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="primary"
                className="flex-1 text-[11px]"
                loading={generateSheetMutation.isPending}
                disabled={!desc.trim()}
                onClick={() => generateSheetMutation.mutate()}
              >
                <Wand2 className="w-3 h-3" />
                AI
              </Button>
              <Button
                size="sm"
                className="flex-1 text-[11px]"
                onClick={() => sheetInputRef.current?.click()}
              >
                <Upload className="w-3 h-3" />
                업로드
              </Button>
              <input
                ref={sheetInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadSheetMutation.mutate(file);
                }}
              />
            </div>
          </div>

          {/* 스프라이트 */}
          <div className="bg-surface-overlay/40 rounded-xl p-2 border border-white/10">
            <div className="aspect-[3/2] bg-[linear-gradient(45deg,#1a1a1a_25%,transparent_25%),linear-gradient(-45deg,#1a1a1a_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1a1a1a_75%),linear-gradient(-45deg,transparent_75%,#1a1a1a_75%)] bg-[length:12px_12px] bg-[position:0_0,0_6px,6px_-6px,-6px_0] rounded-lg overflow-hidden flex items-center justify-center mb-2">
              {character.sprite_path ? (
                <img src={`/${character.sprite_path}`} className="w-full h-full object-contain" />
              ) : (
                <User className="w-6 h-6 text-gray-600" />
              )}
            </div>
            <p className="text-[10px] text-gray-500 mb-1.5">투명배경 스프라이트 (VN_Step4)</p>
            <div className="flex gap-1">
              <Button
                size="sm"
                className="w-full text-[11px]"
                onClick={() => spriteInputRef.current?.click()}
              >
                <Upload className="w-3 h-3" />
                업로드
              </Button>
              <input
                ref={spriteInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadSpriteMutation.mutate(file);
                }}
              />
            </div>
          </div>
        </div>
        <p className="text-[10px] text-gray-600 mt-2">
          씬 이미지 생성 시 우선순위: 스프라이트 &gt; 시트 &gt; 기본 이미지
        </p>
      </div>

      {/* 목소리 섹션 */}
      <div>
        <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wider">목소리 설정</p>

        {character.voice_sample_path && (
          <div className="mb-2 p-2 bg-emerald-950/30 rounded-lg border border-emerald-500/30 flex items-center gap-2 text-xs text-emerald-300">
            <Mic className="w-3.5 h-3.5" />
            보이스 샘플 준비됨
            <audio
              src={`/comfy_input/${character.voice_sample_path}`}
              controls
              className="ml-auto h-7 max-w-60"
            />
          </div>
        )}

        <textarea
          className="input-base w-full resize-none h-14 mb-2"
          placeholder="calm Korean female voice, warm, gentle, 30s housewife"
          value={voiceDesign}
          onChange={(e) => setVoiceDesign(e.target.value)}
        />
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="primary"
            loading={designVoiceMutation.isPending}
            disabled={!voiceDesign.trim()}
            onClick={() => designVoiceMutation.mutate()}
          >
            <Wand2 className="w-3 h-3" />
            Voice Design으로 생성
          </Button>
          <Button size="sm" onClick={() => voiceInputRef.current?.click()}>
            <Upload className="w-3 h-3" />
            WAV 업로드
          </Button>
          <input
            ref={voiceInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadVoiceMutation.mutate(file);
            }}
          />
          <select
            className="input-base py-1 ml-auto"
            value={character.tts_engine}
            onChange={(e) =>
              updateMutation.mutate({ tts_engine: e.target.value as "qwen3" | "s2pro" })
            }
          >
            <option value="qwen3">QWEN3 TTS</option>
            <option value="s2pro">Fish S2 Pro</option>
          </select>
        </div>
      </div>
    </div>
  );
}
