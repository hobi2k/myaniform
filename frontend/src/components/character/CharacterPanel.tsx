import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image as ImageIcon, Mic, Plus, Settings2, Trash2, Upload, User, Wand2, X } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../../api";
import {
  DEFAULT_IMAGE_PARAMS,
  DEFAULT_IMAGE_SAMPLER,
  DEFAULT_IMAGE_SCHEDULER,
  IMAGE_SCHEDULER_OPTIONS,
  SAMPLER_OPTIONS,
} from "../../constants/modelCatalog";
import type { Character, ImageParams, LoraSelection, VoiceGenParams } from "../../types";
import { ImageModelPicker } from "../model/ModelPickers";
import Button from "../ui/Button";

interface Props {
  projectId: string;
}

type CharacterTaskStage =
  | "idle"
  | "preparing"
  | "queued"
  | "running"
  | "saving"
  | "complete"
  | "error";

interface CharacterTaskEvent {
  type: "status" | "complete" | "error";
  stage?: CharacterTaskStage;
  message?: string;
  progress_pct?: number;
  node?: string;
  prompt_id?: string;
  character?: Character;
}

interface CharacterTaskState {
  kind: "image" | "sprite" | "voice" | null;
  label: string;
  stage: CharacterTaskStage;
  message: string;
  progressPct: number;
  node: string | null;
  logs: string[];
  error: string | null;
  running: boolean;
}

const IDLE_TASK: CharacterTaskState = {
  kind: null,
  label: "",
  stage: "idle",
  message: "",
  progressPct: 0,
  node: null,
  logs: [],
  error: null,
  running: false,
};

function parseJson<T>(s: string | null | undefined, defaultValue: T): T {
  if (!s) return defaultValue;
  try {
    return { ...defaultValue, ...JSON.parse(s) };
  } catch {
    return defaultValue;
  }
}

function assetUrl(path: string | null | undefined, version: number) {
  if (!path) return "";
  return `/${path}?v=${version}`;
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
  const [assetVersion, setAssetVersion] = useState(() => Date.now());

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
                  src={assetUrl(c.image_path, assetVersion)}
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
            assetVersion={assetVersion}
            projectId={projectId}
            onUpdated={(c) => {
              setAssetVersion(Date.now());
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
  assetVersion,
  projectId,
  onUpdated,
  onDelete,
}: {
  character: Character;
  assetVersion: number;
  projectId: string;
  onUpdated: (c: Character) => void;
  onDelete: () => void;
}) {
  const referenceImageInputRef = useRef<HTMLInputElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);

  const [desc, setDesc] = useState(character.description ?? "");
  const [backgroundColor, setBackgroundColor] = useState(character.background_color ?? "green");
  const [aesthetics, setAesthetics] = useState(character.aesthetics ?? "masterpiece");
  const [nsfw, setNsfw] = useState<boolean>(character.nsfw ?? true);
  const [sex, setSex] = useState(character.sex ?? "female");
  const [age, setAge] = useState<number | "">(character.age ?? 18);
  const [race, setRace] = useState(character.race ?? "human");
  const [eyes, setEyes] = useState(character.eyes ?? "");
  const [hair, setHair] = useState(character.hair ?? "");
  const [face, setFace] = useState(character.face ?? "");
  const [body, setBody] = useState(character.body ?? "");
  const [skinColor, setSkinColor] = useState(character.skin_color ?? "");
  const [loraPrompt, setLoraPrompt] = useState(character.lora_prompt ?? "");
  const [negativePrompt, setNegativePrompt] = useState(character.negative_prompt ?? "");
  const [voiceDesign, setVoiceDesign] = useState(character.voice_design ?? "");
  const [voiceSampleText, setVoiceSampleText] = useState(character.voice_sample_text ?? "안녕하세요.");
  const [voiceLanguage, setVoiceLanguage] = useState(character.voice_language ?? "Korean");
  const [voiceParams, setVoiceParams] = useState<VoiceGenParams>(
    parseJson<VoiceGenParams>(character.voice_params, {}),
  );
  const [resolutionW, setResolutionW] = useState<number | "">(character.resolution_w ?? "");
  const [resolutionH, setResolutionH] = useState<number | "">(character.resolution_h ?? "");
  const [spriteParams, setSpriteParams] = useState<ImageParams>(
    parseJson<ImageParams>(character.sprite_params, parseJson<ImageParams>(character.image_params, DEFAULT_IMAGE_PARAMS)),
  );
  const [imageParams, setImageParams] = useState<ImageParams>(
    parseJson<ImageParams>(character.image_params, DEFAULT_IMAGE_PARAMS),
  );
  const [showSpriteAdvanced, setShowSpriteAdvanced] = useState(false);
  const [showImageAdvanced, setShowImageAdvanced] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [showVoiceAdvanced, setShowVoiceAdvanced] = useState(false);
  const [task, setTask] = useState<CharacterTaskState>(IDLE_TASK);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Character>) =>
      api.characters.update(projectId, character.id, data),
    onSuccess: onUpdated,
  });

  const uploadReferenceImageMutation = useMutation({
    mutationFn: (file: File) => api.characters.uploadReferenceImage(projectId, character.id, file),
    onSuccess: onUpdated,
  });

  const uploadVoiceMutation = useMutation({
    mutationFn: (file: File) => api.characters.uploadVoice(projectId, character.id, file),
    onSuccess: onUpdated,
  });

  const appendTaskLog = (message: string) => {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    setTask((prev) => ({ ...prev, logs: [...prev.logs, line] }));
  };

  const persistCharacterOptions = () =>
    api.characters.update(projectId, character.id, {
      description: desc,
      background_color: backgroundColor,
      aesthetics,
      nsfw,
      sex,
      age: age === "" ? null : age,
      race,
      eyes,
      hair,
      face,
      body,
      skin_color: skinColor,
      lora_prompt: loraPrompt,
      negative_prompt: negativePrompt,
      resolution_w: resolutionW === "" ? null : resolutionW,
      resolution_h: resolutionH === "" ? null : resolutionH,
      image_params: JSON.stringify(imageParams),
      sprite_params: JSON.stringify(spriteParams),
      voice_sample_text: voiceSampleText,
      voice_language: voiceLanguage,
      voice_params: JSON.stringify(voiceParams),
    });

  const shouldLogStatus = (ev: CharacterTaskEvent) => {
    if (ev.stage !== "running") return true;
    const pct = ev.progress_pct ?? -1;
    return pct >= 0 && pct % 10 === 0;
  };

  const runTaskStream = async ({
    kind,
    label,
    url,
    body,
    beforeStart,
  }: {
    kind: "image" | "sprite" | "voice";
    label: string;
    url: string;
    body?: unknown;
    beforeStart?: () => Promise<void>;
  }) => {
    setTask({
      kind,
      label,
      stage: "preparing",
      message: "작업 준비 중...",
      progressPct: 1,
      node: null,
      logs: [],
      error: null,
      running: true,
    });
    appendTaskLog(`${label} 시작`);

    try {
      if (beforeStart) await beforeStart();

      const resp = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail ?? `${label} 요청 실패`);
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
          const ev: CharacterTaskEvent = JSON.parse(line.slice(6));
          if (ev.type === "status") {
            setTask((prev) => ({
              ...prev,
              stage: ev.stage ?? prev.stage,
              message: ev.message ?? prev.message,
              progressPct: ev.progress_pct ?? prev.progressPct,
              node: ev.node ?? prev.node,
              running: (ev.stage ?? prev.stage) !== "complete",
            }));
            if (ev.message && shouldLogStatus(ev)) appendTaskLog(ev.message);
          } else if (ev.type === "complete" && ev.character) {
            setTask((prev) => ({
              ...prev,
              stage: "complete",
              message: `${label} 완료`,
              progressPct: 100,
              running: false,
            }));
            appendTaskLog(`${label} 완료`);
            onUpdated(ev.character);
          } else if (ev.type === "error") {
            throw new Error(ev.message ?? `${label} 실패`);
          }
        }
      }
    } catch (err) {
      const message = (err as Error).message;
      setTask((prev) => ({
        ...prev,
        stage: "error",
        message,
        error: message,
        running: false,
      }));
      appendTaskLog(`오류: ${message}`);
    }
  };

  const startImageGeneration = () =>
    runTaskStream({
      kind: "image",
      label: "캐릭터 이미지 생성",
      url: `/api/projects/${projectId}/characters/${character.id}/image/generate/stream`,
      beforeStart: () => persistCharacterOptions().then(() => undefined),
    });

  const startSpriteGeneration = (mode: "new" | "reference") =>
    runTaskStream({
      kind: "sprite",
      label: mode === "new" ? "신규 스프라이트 생성" : "참조 이미지 기반 스프라이트 생성",
      url: `/api/projects/${projectId}/characters/${character.id}/sprite/generate/stream?mode=${mode}`,
      beforeStart: () => persistCharacterOptions().then(() => undefined),
    });

  const generationBusy = task.running;
  const hasSprite = !!character.sprite_path;
  const hasReferenceImage = !!character.image_path;
  const hasImage = !!character.image_path && character.image_path.includes("_generated");
  const spriteBlocked = !desc.trim();
  const imageBlocked = !hasSprite;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">{character.name}</h3>
        <button onClick={onDelete} className="p-1.5 hover:text-red-400 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="rounded-xl border border-accent/20 bg-accent/5 p-3">
        <p className="text-xs font-semibold text-accent mb-1">권장 순서</p>
        <p className="text-sm text-gray-300">
          1. 캐릭터 스프라이트 생성/복제 → 2. 씬에서 스프라이트 기반 장면샷 생성 → 3. 영상 생성
        </p>
        <p className="text-[11px] text-gray-500 mt-1">
          신규 스프라이트는 VN Step1, 참조 이미지 기반 스프라이트는 VN Step1.1 원본 워크플로우를 사용합니다.
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-surface-overlay/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">0. 캐릭터 설정</p>
            <p className="text-sm text-gray-300">설명과 세부 속성을 먼저 정리합니다.</p>
          </div>
          <span className="text-[11px] text-gray-500">{desc.trim() ? "준비됨" : "설명 필요"}</span>
        </div>
        <textarea
          className="input-base w-full resize-none h-20"
          placeholder="1girl, brown hair, bob cut, 30s, gentle expression, anime style..."
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
        <div className="border-t border-white/10 pt-2">
          <button
            type="button"
            onClick={() => setShowSpriteAdvanced((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-accent transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5" />
            스프라이트 설정 {showSpriteAdvanced ? "▲" : "▼"}
          </button>
          {showSpriteAdvanced && (
            <div className="mt-3 space-y-3 bg-surface-raised/40 rounded-lg p-3 border border-white/5">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">배경색</label>
                  <input className="input-base w-full" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} />
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">Aesthetics</label>
                  <input className="input-base w-full" value={aesthetics} onChange={(e) => setAesthetics(e.target.value)} />
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">성별</label>
                  <input className="input-base w-full" value={sex} onChange={(e) => setSex(e.target.value)} />
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">나이</label>
                  <input type="number" className="input-base w-full" value={age} onChange={(e) => setAge(e.target.value ? parseInt(e.target.value) : "")} />
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">종족</label>
                  <input className="input-base w-full" value={race} onChange={(e) => setRace(e.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-[11px] text-gray-300 mt-5">
                  <input type="checkbox" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} />
                  NSFW
                </label>
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">Eyes</label>
                  <input className="input-base w-full" value={eyes} onChange={(e) => setEyes(e.target.value)} />
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">Hair</label>
                  <input className="input-base w-full" value={hair} onChange={(e) => setHair(e.target.value)} />
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">Face</label>
                  <input className="input-base w-full" value={face} onChange={(e) => setFace(e.target.value)} />
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">Body</label>
                  <input className="input-base w-full" value={body} onChange={(e) => setBody(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] text-gray-400 mb-1 block">Skin Color</label>
                  <input className="input-base w-full" value={skinColor} onChange={(e) => setSkinColor(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-gray-400 mb-1 block">LoRA Prompt</label>
                <textarea
                  className="input-base w-full resize-none h-14"
                  placeholder="bad quality,worst quality,..."
                  value={loraPrompt}
                  onChange={(e) => setLoraPrompt(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 mb-1 block">Negative Prompt</label>
                <textarea
                  className="input-base w-full resize-none h-14"
                  placeholder="worst quality, low quality, blurry, text, watermark..."
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">너비</label>
                  <input
                    type="number"
                    className="input-base w-full"
                    placeholder="832"
                    value={resolutionW}
                    onChange={(e) => setResolutionW(e.target.value ? parseInt(e.target.value) : "")}
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 mb-1 block">높이</label>
                  <input
                    type="number"
                    className="input-base w-full"
                    placeholder="1216"
                    value={resolutionH}
                    onChange={(e) => setResolutionH(e.target.value ? parseInt(e.target.value) : "")}
                  />
                </div>
              </div>
              <CharacterImageParamsEditor
                title="스프라이트 생성 파라미터"
                workflow="sdxl"
                value={spriteParams}
                onChange={setSpriteParams}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={updateMutation.isPending}
                  disabled={generationBusy}
                  onClick={() =>
                    updateMutation.mutate({
                      description: desc,
                      background_color: backgroundColor,
                      aesthetics,
                      nsfw,
                      sex,
                      age: age === "" ? null : age,
                      race,
                      eyes,
                      hair,
                      face,
                      body,
                      skin_color: skinColor,
                      lora_prompt: loraPrompt,
                      negative_prompt: negativePrompt,
                      resolution_w: resolutionW === "" ? null : resolutionW,
                      resolution_h: resolutionH === "" ? null : resolutionH,
                      image_params: JSON.stringify(imageParams),
                      sprite_params: JSON.stringify(spriteParams),
                    })
                  }
                >
                  설정 저장
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-surface-overlay/30 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">1. 캐릭터 스프라이트</p>
              <p className="text-sm text-gray-300">처음부터 만들거나 업로드 참조 이미지로 복제합니다.</p>
            </div>
            <span className={`text-[11px] ${hasSprite ? "text-emerald-300" : "text-gray-500"}`}>
              {hasSprite ? "완료" : "대기"}
            </span>
          </div>
          <div className="aspect-[3/2] bg-surface-overlay rounded-lg overflow-hidden flex items-center justify-center border border-white/5">
            {hasSprite ? (
              <button
                type="button"
                className="w-full h-full"
                onClick={() => setPreviewPath(character.sprite_path)}
                title="확대 보기"
              >
                <img src={assetUrl(character.sprite_path, assetVersion)} className="w-full h-full object-contain" />
              </button>
            ) : (
              <User className="w-8 h-8 text-gray-600" />
            )}
          </div>
          <div className="rounded-lg border border-white/5 bg-black/10 p-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] text-gray-400 font-semibold">참조 이미지</p>
                <p className="text-[10px] text-gray-500 truncate">
                  {hasReferenceImage ? "업로드됨: Step1.1 복제 생성에 사용" : "선택 사항: 기존 캐릭터 이미지가 있을 때 사용"}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={generationBusy || uploadReferenceImageMutation.isPending}
                loading={uploadReferenceImageMutation.isPending}
                onClick={() => referenceImageInputRef.current?.click()}
              >
                <Upload className="w-3 h-3" />
                참조 업로드
              </Button>
              <input
                ref={referenceImageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadReferenceImageMutation.mutate(file);
                  e.target.value = "";
                }}
              />
            </div>
            {hasReferenceImage && (
              <button
                type="button"
                className="w-full overflow-hidden rounded-md border border-white/5 bg-surface-overlay"
                onClick={() => setPreviewPath(character.image_path)}
                title="참조 이미지 확대 보기"
              >
                <img src={assetUrl(character.image_path, assetVersion)} className="max-h-24 w-full object-contain" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2">
            <Button
              size="sm"
              variant="primary"
              className="w-full"
              loading={generationBusy && task.kind === "sprite"}
              disabled={spriteBlocked || generationBusy}
              onClick={() => startSpriteGeneration("new")}
            >
              <Wand2 className="w-3 h-3" />
              {hasSprite ? "처음부터 스프라이트 재생성" : "처음부터 스프라이트 생성"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              loading={generationBusy && task.kind === "sprite"}
              disabled={spriteBlocked || generationBusy || !hasReferenceImage}
              onClick={() => startSpriteGeneration("reference")}
            >
              <Wand2 className="w-3 h-3" />
              참조 이미지로 스프라이트 생성
            </Button>
          </div>
          <p className="text-[11px] text-gray-500">
            {spriteBlocked
              ? "설명 프롬프트를 먼저 입력하세요."
              : "생성된 스프라이트가 장면샷과 영상 프레임의 캐릭터 일관성 레퍼런스가 됩니다."}
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-surface-overlay/30 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider font-medium">2. 캐릭터 키비주얼</p>
              <p className="text-sm text-gray-300">선택 사항입니다. 실제 영상 장면샷은 씬 탭에서 생성합니다.</p>
            </div>
            <span className={`text-[11px] ${hasImage ? "text-emerald-300" : "text-gray-500"}`}>
              {hasImage ? "완료" : "대기"}
            </span>
          </div>
          <div className="aspect-square bg-surface-overlay rounded-lg overflow-hidden flex items-center justify-center border border-white/5">
            {hasImage ? (
              <button
                type="button"
                className="w-full h-full"
                onClick={() => setPreviewPath(character.image_path)}
                title="확대 보기"
              >
                <img src={assetUrl(character.image_path, assetVersion)} className="w-full h-full object-cover" />
              </button>
            ) : (
              <ImageIcon className="w-8 h-8 text-gray-600" />
            )}
          </div>
          <div className="border-t border-white/10 pt-2">
            <button
              type="button"
              onClick={() => setShowImageAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-accent transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              이미지 설정 {showImageAdvanced ? "▲" : "▼"}
            </button>
            {showImageAdvanced && (
              <div className="mt-3 bg-surface-raised/40 rounded-lg p-3 border border-white/5">
                <CharacterImageParamsEditor
                  title="이미지 생성 파라미터"
                  workflow="qwen_edit"
                  value={imageParams}
                  onChange={setImageParams}
                />
              </div>
            )}
          </div>
          <Button
            size="sm"
            variant="primary"
            className="w-full"
            loading={generationBusy && task.kind === "image"}
            disabled={imageBlocked || generationBusy}
            onClick={startImageGeneration}
          >
            <Wand2 className="w-3 h-3" />
            {hasImage ? "키비주얼 재생성" : "키비주얼 생성"}
          </Button>
          <p className="text-[11px] text-gray-500">
            {imageBlocked ? "먼저 스프라이트를 준비하세요." : "장면샷은 여기서 업로드하지 않고, 씬 프롬프트와 스프라이트 레퍼런스로 생성합니다."}
          </p>
        </div>
      </div>

      {/* 목소리 섹션 */}
      <div>
        <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wider">목소리 설정</p>

        {character.voice_sample_path && (
          <div className="mb-2 p-2 bg-emerald-950/30 rounded-lg border border-emerald-500/30 flex items-center gap-2 text-xs text-emerald-300">
            <Mic className="w-3.5 h-3.5" />
            보이스 샘플 준비됨
            <audio
              src={assetUrl(character.voice_sample_path, assetVersion)}
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
        <div className="border-t border-white/10 pt-2 mb-2">
          <button
            type="button"
            onClick={() => setShowVoiceAdvanced((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-accent transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5" />
            고급 옵션 {showVoiceAdvanced ? "▲" : "▼"}
          </button>
          {showVoiceAdvanced && (
            <div className="mt-3 space-y-3 bg-surface-raised/40 rounded-lg p-3 border border-white/5">
              <div>
                <label className="text-[11px] text-gray-400 mb-1 block">샘플 문장</label>
                <textarea
                  className="input-base w-full resize-none h-14"
                  placeholder="안녕하세요. 오늘도 잘 부탁드려요."
                  value={voiceSampleText}
                  onChange={(e) => setVoiceSampleText(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 mb-1 block">언어</label>
                <select
                  className="input-base w-full"
                  value={voiceLanguage}
                  onChange={(e) => setVoiceLanguage(e.target.value)}
                >
                  <option value="Korean">Korean</option>
                  <option value="English">English</option>
                  <option value="Japanese">Japanese</option>
                  <option value="Chinese">Chinese</option>
                </select>
              </div>
              <VoiceParamsEditor value={voiceParams} onChange={setVoiceParams} />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={updateMutation.isPending}
                  disabled={generationBusy}
                  onClick={() =>
                    updateMutation.mutate({
                      voice_sample_text: voiceSampleText,
                      voice_language: voiceLanguage,
                      voice_params: JSON.stringify(voiceParams),
                      voice_design: voiceDesign,
                    })
                  }
                >
                  음성 설정 저장
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="primary"
            loading={generationBusy && task.kind === "voice"}
            disabled={!voiceDesign.trim() || generationBusy}
            onClick={() =>
              runTaskStream({
                kind: "voice",
                label: "보이스 디자인 생성",
                url: `/api/projects/${projectId}/characters/${character.id}/voice/design/stream`,
                body: { voice_design: voiceDesign },
                beforeStart: () => persistCharacterOptions().then(() => undefined),
              })
            }
          >
            <Wand2 className="w-3 h-3" />
            {character.voice_sample_path ? "보이스 샘플 재생성" : "Voice Design 샘플 생성"}
          </Button>
          <Button size="sm" disabled={generationBusy} onClick={() => voiceInputRef.current?.click()}>
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
            disabled={generationBusy}
            value={character.tts_engine}
            onChange={(e) =>
              updateMutation.mutate({ tts_engine: e.target.value as "qwen3" | "s2pro" })
            }
          >
            <option value="qwen3">QWEN3 TTS</option>
            <option value="s2pro">Fish S2 Pro</option>
          </select>
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          Voice Design 샘플 생성은 Qwen3 VoiceDesign 워크플로우를 사용합니다. Fish S2 Pro는 이 샘플/업로드 WAV를 레퍼런스로 받아 Voice Clone TTS를 수행합니다.
        </p>
      </div>

      {(character.image_path || character.sprite_path || character.voice_sample_path) && (
        <div className="space-y-3 border-t border-white/10 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              자산 재생성
            </span>
            <span className="text-[10px] text-gray-600">
              기존 결과물을 덮어씁니다
            </span>
          </div>

          {hasImage && (
            <div className="flex items-start gap-2">
              <Button
                size="sm"
                variant="secondary"
                loading={generationBusy && task.kind === "image"}
                disabled={!desc.trim() || generationBusy}
                onClick={startImageGeneration}
              >
                🖼️ 키비주얼 재생성
              </Button>
              <div className="flex-1 min-w-0">
                <img
                  src={assetUrl(character.image_path, assetVersion)}
                  className="w-16 h-16 rounded-lg object-cover border border-white/10"
                />
              </div>
            </div>
          )}

          {character.sprite_path && (
            <div className="flex items-start gap-2">
              <Button
                size="sm"
                variant="secondary"
                loading={generationBusy && task.kind === "sprite"}
                disabled={!desc.trim() || generationBusy}
                onClick={() => startSpriteGeneration("new")}
              >
                처음부터 스프라이트 재생성
              </Button>
              <div className="flex-1 min-w-0">
                <button type="button" onClick={() => setPreviewPath(character.sprite_path)}>
                  <img
                    src={assetUrl(character.sprite_path, assetVersion)}
                    className="w-20 h-12 rounded-lg object-contain bg-surface-overlay border border-white/10"
                  />
                </button>
              </div>
            </div>
          )}

          {character.voice_sample_path && (
            <div className="flex items-start gap-2">
              <Button
                size="sm"
                variant="secondary"
                loading={generationBusy && task.kind === "voice"}
                disabled={!voiceDesign.trim() || generationBusy}
                onClick={() =>
                  runTaskStream({
                    kind: "voice",
                    label: "보이스 디자인 생성",
                    url: `/api/projects/${projectId}/characters/${character.id}/voice/design/stream`,
                    body: { voice_design: voiceDesign },
                    beforeStart: () => persistCharacterOptions().then(() => undefined),
                  })
                }
              >
                🎤 보이스 재생성
              </Button>
              <div className="flex-1 min-w-0">
                <audio
                  src={assetUrl(character.voice_sample_path, assetVersion)}
                  controls
                  className="w-full h-8"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {(task.stage !== "idle" || task.logs.length > 0) && (
        <div className={`rounded-xl border p-3 ${
          task.stage === "error"
            ? "border-red-500/40 bg-red-950/20"
            : task.stage === "complete"
            ? "border-emerald-500/40 bg-emerald-950/20"
            : "border-accent/30 bg-surface-overlay/40"
        }`}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gray-200 truncate">
                {task.label || "작업 상태"}
              </p>
              <p className="text-[11px] text-gray-400 truncate">
                {task.message || "대기 중"}
              </p>
            </div>
            <span className="text-xs font-mono text-accent flex-shrink-0">
              {task.progressPct}%
            </span>
          </div>
          <div className="h-2 bg-surface-sunken rounded-full overflow-hidden mb-2">
            <div
              className={`h-full transition-all duration-300 ${
                task.stage === "error"
                  ? "bg-red-500"
                  : task.stage === "complete"
                  ? "bg-emerald-500"
                  : "bg-gradient-to-r from-accent-hover to-accent"
              }`}
              style={{ width: `${task.progressPct}%` }}
            />
          </div>
          {task.node && task.stage === "running" && (
            <p className="text-[11px] text-gray-500 mb-2">현재 노드: {task.node}</p>
          )}
          <div className="rounded-lg bg-black/30 border border-white/5 p-2 max-h-36 overflow-y-auto font-mono text-[11px] text-gray-300 space-y-0.5">
            {task.logs.length === 0 ? (
              <div className="text-gray-600">로그 대기 중...</div>
            ) : (
              task.logs.map((line, index) => (
                <div key={index} className="whitespace-pre-wrap break-all">
                  {line}
                </div>
              ))
            )}
          </div>
          {task.error && (
            <p className="mt-2 text-xs text-red-300">{task.error}</p>
          )}
        </div>
      )}

      {previewPath && (
        <div
          className="fixed inset-0 z-50 bg-black/80 p-6 flex items-center justify-center"
          onClick={() => setPreviewPath(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white"
            onClick={() => setPreviewPath(null)}
            title="닫기"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={assetUrl(previewPath, assetVersion)}
            className="max-w-full max-h-full object-contain rounded-lg border border-white/20"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function CharacterImageParamsEditor({
  title = "이미지 파라미터",
  workflow = "sdxl",
  value,
  onChange,
}: {
  title?: string;
  workflow?: "sdxl" | "qwen_edit";
  value: ImageParams;
  onChange: (p: ImageParams) => void;
}) {
  const set = (k: keyof ImageParams, v: number | string | boolean | undefined) => {
    const next = { ...value };
    if (v === "" || v === undefined) {
      delete (next as Record<string, unknown>)[k as string];
    } else {
      (next as Record<string, unknown>)[k as string] = v;
    }
    onChange(next);
  };

  return (
    <div className="border-t border-white/5 pt-2">
      <div className="text-[11px] text-gray-400 mb-2 font-semibold">{title}</div>
      <ImageModelPicker
        workflow={workflow}
        value={value.model ?? ""}
        onChange={(model) => set("model", model || undefined)}
      />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-gray-500">steps</label>
          <input
            type="number"
            className="input-base w-full"
            placeholder="30"
            value={value.steps ?? ""}
            onChange={(e) => set("steps", e.target.value ? parseInt(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">cfg</label>
          <input
            type="number"
            step="0.1"
            className="input-base w-full"
            placeholder="5.0"
            value={value.cfg ?? ""}
            onChange={(e) => set("cfg", e.target.value ? parseFloat(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">seed</label>
          <input
            type="number"
            className="input-base w-full"
            placeholder="0"
            value={value.seed ?? ""}
            onChange={(e) => set("seed", e.target.value ? parseInt(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">sampler</label>
          <select
            className="input-base w-full"
            value={value.sampler ?? DEFAULT_IMAGE_SAMPLER}
            onChange={(e) => set("sampler", e.target.value)}
          >
            {SAMPLER_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500">scheduler</label>
          <select
            className="input-base w-full"
            value={value.scheduler ?? DEFAULT_IMAGE_SCHEDULER}
            onChange={(e) => set("scheduler", e.target.value)}
          >
            {IMAGE_SCHEDULER_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500">denoise</label>
          <input
            type="number"
            step="0.05"
            className="input-base w-full"
            placeholder="1.0"
            value={value.denoise ?? ""}
            onChange={(e) => set("denoise", e.target.value ? parseFloat(e.target.value) : undefined)}
          />
        </div>
      </div>
      <div className="flex items-center gap-4 mt-2 text-[11px]">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={value.face_detailer !== false}
            onChange={(e) => set("face_detailer", e.target.checked ? undefined : false)}
          />
          <span>Face Detailer</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={value.hand_detailer !== false}
            onChange={(e) => set("hand_detailer", e.target.checked ? undefined : false)}
          />
          <span>Hand Detailer</span>
        </label>
      </div>
      {workflow === "qwen_edit" && (
        <div className="mt-3 rounded-lg border border-white/5 bg-black/10 p-2">
          <div className="text-[10px] text-gray-500 mb-2 font-semibold">Qwen Image Edit 레퍼런스 브랜치</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <NumberParam label="Lightning LoRA" placeholder="1.0" step="0.05" value={value.qwen_lightning_strength} onChange={(v) => set("qwen_lightning_strength", v)} />
            <NumberParam label="Pose LoRA" placeholder="1.0" step="0.05" value={value.qwen_pose_strength} onChange={(v) => set("qwen_pose_strength", v)} />
            <NumberParam label="Clothes LoRA" placeholder="0.8" step="0.05" value={value.qwen_clothes_strength} onChange={(v) => set("qwen_clothes_strength", v)} />
            <NumberParam label="layers" placeholder="3" value={value.qwen_layers} onChange={(v) => set("qwen_layers", v)} />
            <NumberParam label="start_at_step" placeholder="0" value={value.qwen_start_at_step} onChange={(v) => set("qwen_start_at_step", v)} />
            <NumberParam label="end_at_step" placeholder="10000" value={value.qwen_end_at_step} onChange={(v) => set("qwen_end_at_step", v)} />
          </div>
        </div>
      )}
      <div className="mt-3 rounded-lg border border-white/5 bg-black/10 p-2">
        <div className="text-[10px] text-gray-500 mb-2 font-semibold">Face/Hand Detailer 세부값</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <NumberParam label="detailer_steps" placeholder="10" value={value.detailer_steps} onChange={(v) => set("detailer_steps", v)} />
          <NumberParam label="detailer_cfg" placeholder="4.5" step="0.1" value={value.detailer_cfg} onChange={(v) => set("detailer_cfg", v)} />
          <NumberParam label="detailer_denoise" placeholder="0.25" step="0.05" value={value.detailer_denoise} onChange={(v) => set("detailer_denoise", v)} />
          <NumberParam label="guide_size" placeholder="512" value={value.detailer_guide_size} onChange={(v) => set("detailer_guide_size", v)} />
          <NumberParam label="max_size" placeholder="1536" value={value.detailer_max_size} onChange={(v) => set("detailer_max_size", v)} />
          <NumberParam label="bbox_threshold" placeholder="0.5" step="0.05" value={value.bbox_threshold} onChange={(v) => set("bbox_threshold", v)} />
          <NumberParam label="bbox_dilation" placeholder="10" value={value.bbox_dilation} onChange={(v) => set("bbox_dilation", v)} />
          <NumberParam label="crop_factor" placeholder="3.0" step="0.1" value={value.bbox_crop_factor} onChange={(v) => set("bbox_crop_factor", v)} />
          <NumberParam label="sam_threshold" placeholder="0.7" step="0.01" value={value.sam_threshold} onChange={(v) => set("sam_threshold", v)} />
          <NumberParam label="mask_feather" placeholder="20" value={value.noise_mask_feather} onChange={(v) => set("noise_mask_feather", v)} />
        </div>
      </div>
      <div className="mt-3">
        <CharacterLoraPicker
          value={(value.loras as LoraSelection[]) ?? []}
          onChange={(loras) => {
            const next = { ...value };
            if (loras.length) (next as Record<string, unknown>).loras = loras;
            else delete (next as Record<string, unknown>).loras;
            onChange(next);
          }}
        />
      </div>
    </div>
  );
}

function NumberParam({
  label,
  placeholder,
  value,
  step,
  onChange,
}: {
  label: string;
  placeholder: string;
  value?: number;
  step?: string;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <div>
      <label className="text-[10px] text-gray-500">{label}</label>
      <input
        type="number"
        step={step}
        className="input-base w-full"
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
      />
    </div>
  );
}

function CharacterLoraPicker({
  value,
  onChange,
}: {
  value: LoraSelection[];
  onChange: (v: LoraSelection[]) => void;
}) {
  const { data: available = [] } = useQuery({
    queryKey: ["loras"],
    queryFn: () => api.loras.list(),
    staleTime: 60_000,
  });
  const remaining = available.filter((e) => !value.some((v) => v.name === e.name));
  const [customName, setCustomName] = useState("");

  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || value.some((v) => v.name === trimmed)) return;
    onChange([...value, { name: trimmed, strength: 1.0 }]);
  };
  const update = (idx: number, patch: Partial<LoraSelection>) =>
    onChange(value.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  return (
    <div>
      <label className="text-xs text-gray-400 mb-1 block">LoRA 추가 (선택)</label>
      <div className="space-y-1.5">
        {value.map((l, idx) => (
          <div key={idx} className="flex items-center gap-2 text-xs">
            <span className="flex-1 truncate input-base py-1">{l.name}</span>
            <input
              type="number"
              step="0.05"
              min="-2"
              max="2"
              value={l.strength}
              onChange={(e) => update(idx, { strength: parseFloat(e.target.value) })}
              className="input-base w-16 py-1"
            />
            <button
              onClick={() => remove(idx)}
              className="p-1 hover:text-red-400 transition-colors"
              title="제거"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <select
          className="input-base w-full"
          value=""
          onChange={(e) => {
            add(e.target.value);
            e.target.value = "";
          }}
        >
          <option value="">+ 목록에서 선택... ({remaining.length}개)</option>
          {remaining.map((e) => (
            <option key={e.name} value={e.name}>
              {e.group ? `[${e.group}] ` : ""}
              {e.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          <input
            type="text"
            placeholder="직접 입력: my_lora.safetensors"
            className="input-base flex-1 py-1 text-xs"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(customName);
                setCustomName("");
              }
            }}
          />
          <button
            type="button"
            onClick={() => {
              add(customName);
              setCustomName("");
            }}
            disabled={!customName.trim()}
            className="px-2 py-1 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs"
            title="추가"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function VoiceParamsEditor({
  value,
  onChange,
}: {
  value: VoiceGenParams;
  onChange: (p: VoiceGenParams) => void;
}) {
  const set = (k: keyof VoiceGenParams, v: number | undefined) => {
    const next = { ...value };
    if (v === undefined || Number.isNaN(v)) {
      delete (next as Record<string, unknown>)[k as string];
    } else {
      (next as Record<string, unknown>)[k as string] = v;
    }
    onChange(next);
  };

  return (
    <div className="border-t border-white/5 pt-2">
      <div className="text-[11px] text-gray-400 mb-2 font-semibold">🎙️ 보이스 파라미터</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-gray-500">top_k</label>
          <input
            type="number"
            className="input-base w-full"
            placeholder="50"
            value={value.top_k ?? ""}
            onChange={(e) => set("top_k", e.target.value ? parseInt(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">top_p</label>
          <input
            type="number"
            step="0.01"
            className="input-base w-full"
            placeholder="1.0"
            value={value.top_p ?? ""}
            onChange={(e) => set("top_p", e.target.value ? parseFloat(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">temperature</label>
          <input
            type="number"
            step="0.05"
            className="input-base w-full"
            placeholder="0.9"
            value={value.temperature ?? ""}
            onChange={(e) => set("temperature", e.target.value ? parseFloat(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">repetition_penalty</label>
          <input
            type="number"
            step="0.01"
            className="input-base w-full"
            placeholder="1.05"
            value={value.repetition_penalty ?? ""}
            onChange={(e) => set("repetition_penalty", e.target.value ? parseFloat(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">max_new_tokens</label>
          <input
            type="number"
            className="input-base w-full"
            placeholder="2048"
            value={value.max_new_tokens ?? ""}
            onChange={(e) => set("max_new_tokens", e.target.value ? parseInt(e.target.value) : undefined)}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500">seed</label>
          <input
            type="number"
            className="input-base w-full"
            placeholder="-1"
            value={value.seed ?? ""}
            onChange={(e) => set("seed", e.target.value ? parseInt(e.target.value) : undefined)}
          />
        </div>
      </div>
    </div>
  );
}
