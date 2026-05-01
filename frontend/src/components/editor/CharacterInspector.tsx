import { useMutation } from "@tanstack/react-query";
import { Image as ImageIcon, Mic, Settings2, Upload, User, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { DEFAULT_IMAGE_PARAMS } from "../../constants/modelCatalog";
import { useGenerationStream } from "../../hooks/useGenerationStream";
import { parseJson } from "../../lib/json";
import type { Character, ImageParams, VoiceGenParams } from "../../types";
import ImageParamsEditor from "../shared/ImageParamsEditor";
import MiniTabs from "../shared/MiniTabs";
import StepCard, { type StepState } from "../shared/StepCard";
import TaskProgress from "../shared/TaskProgress";
import VoiceParamsEditor from "../shared/VoiceParamsEditor";
import Button from "../ui/Button";

interface Props {
  projectId: string;
  character: Character;
  onUpdated: (c: Character) => void;
}

export default function CharacterInspector({ projectId, character, onUpdated }: Props) {
  const referenceInputRef = useRef<HTMLInputElement>(null);
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
  const [resolutionW, setResolutionW] = useState<number | "">(character.resolution_w ?? "");
  const [resolutionH, setResolutionH] = useState<number | "">(character.resolution_h ?? "");
  const [spriteParams, setSpriteParams] = useState<ImageParams>(
    parseJson<ImageParams>(character.sprite_params, parseJson<ImageParams>(character.image_params, DEFAULT_IMAGE_PARAMS)),
  );
  const [imageParams, setImageParams] = useState<ImageParams>(
    parseJson<ImageParams>(character.image_params, DEFAULT_IMAGE_PARAMS),
  );
  const [voiceDesign, setVoiceDesign] = useState(character.voice_design ?? "");
  const [voiceSampleText, setVoiceSampleText] = useState(character.voice_sample_text ?? "안녕하세요.");
  const [voiceLanguage, setVoiceLanguage] = useState(character.voice_language ?? "Korean");
  const [voiceParams, setVoiceParams] = useState<VoiceGenParams>(parseJson<VoiceGenParams>(character.voice_params, {}));

  const [openStep, setOpenStep] = useState<number | null>(0);
  const [spriteMode, setSpriteMode] = useState<"new" | "reference">(
    character.image_path && !character.image_path.includes("_generated") ? "reference" : "new",
  );
  const [voiceMode, setVoiceMode] = useState<"design" | "upload">(
    character.tts_engine === "s2pro" && !character.voice_design ? "upload" : "design",
  );
  const { task, run } = useGenerationStream<Character>();

  // Re-sync local form when a new character arrives.
  useEffect(() => {
    setDesc(character.description ?? "");
    setBackgroundColor(character.background_color ?? "green");
    setAesthetics(character.aesthetics ?? "masterpiece");
    setNsfw(character.nsfw ?? true);
    setSex(character.sex ?? "female");
    setAge(character.age ?? 18);
    setRace(character.race ?? "human");
    setEyes(character.eyes ?? "");
    setHair(character.hair ?? "");
    setFace(character.face ?? "");
    setBody(character.body ?? "");
    setSkinColor(character.skin_color ?? "");
    setLoraPrompt(character.lora_prompt ?? "");
    setNegativePrompt(character.negative_prompt ?? "");
    setResolutionW(character.resolution_w ?? "");
    setResolutionH(character.resolution_h ?? "");
    setSpriteParams(parseJson<ImageParams>(character.sprite_params, parseJson<ImageParams>(character.image_params, DEFAULT_IMAGE_PARAMS)));
    setImageParams(parseJson<ImageParams>(character.image_params, DEFAULT_IMAGE_PARAMS));
    setVoiceDesign(character.voice_design ?? "");
    setVoiceSampleText(character.voice_sample_text ?? "안녕하세요.");
    setVoiceLanguage(character.voice_language ?? "Korean");
    setVoiceParams(parseJson<VoiceGenParams>(character.voice_params, {}));
    setSpriteMode(character.image_path && !character.image_path.includes("_generated") ? "reference" : "new");
    setVoiceMode(character.tts_engine === "s2pro" && !character.voice_design ? "upload" : "design");
  }, [character.id]);

  const persistAll = () =>
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
      voice_design: voiceDesign,
    });

  const saveSettings = useMutation({
    mutationFn: persistAll,
    onSuccess: onUpdated,
  });

  const uploadReference = useMutation({
    mutationFn: (file: File) => api.characters.uploadReferenceImage(projectId, character.id, file),
    onSuccess: onUpdated,
  });

  const uploadVoice = useMutation({
    mutationFn: (file: File) => api.characters.uploadVoice(projectId, character.id, file),
    onSuccess: onUpdated,
  });

  const startSprite = (mode: "new" | "reference") =>
    run({
      kind: "sprite",
      label: mode === "new" ? "신규 스프라이트 생성" : "참조 이미지 기반 스프라이트 생성",
      url: `/api/projects/${projectId}/characters/${character.id}/sprite/generate/stream?mode=${mode}`,
      payloadField: "character",
      beforeStart: async () => {
        await persistAll();
      },
      onComplete: onUpdated,
    });

  const startImage = () =>
    run({
      kind: "image",
      label: "씬 프리뷰 생성",
      url: `/api/projects/${projectId}/characters/${character.id}/image/generate/stream`,
      payloadField: "character",
      beforeStart: async () => {
        await persistAll();
      },
      onComplete: onUpdated,
    });

  const startVoice = () =>
    run({
      kind: "voice",
      label: "보이스 디자인 생성",
      url: `/api/projects/${projectId}/characters/${character.id}/voice/design/stream`,
      body: { voice_design: voiceDesign },
      payloadField: "character",
      beforeStart: async () => {
        await persistAll();
      },
      onComplete: onUpdated,
    });

  const busy = task.running;
  const hasSprite = !!character.sprite_path;
  const hasReference = !!character.image_path && !character.image_path.includes("_generated");
  const hasImage = !!character.image_path && character.image_path.includes("_generated");

  const settingsState: StepState = desc.trim() ? "ready" : "todo";
  const spriteState: StepState =
    busy && task.kind === "sprite" ? "running" : hasSprite ? "done" : desc.trim() ? "ready" : "blocked";
  const imageState: StepState =
    busy && task.kind === "image" ? "running" : hasImage ? "done" : hasSprite ? "ready" : "blocked";
  const voiceState: StepState =
    busy && task.kind === "voice" ? "running" : character.voice_sample_path ? "done" : voiceDesign.trim() ? "ready" : "todo";

  return (
    <div className="p-3 space-y-3">
      <header className="px-1 mb-1 flex items-center gap-2">
        <User className="w-4 h-4 text-accent" />
        <h2 className="text-sm font-semibold text-white">{character.name}</h2>
        <span className="ml-auto text-[10px] text-gray-500">캐릭터 인스펙터</span>
      </header>

      <p className="text-[11px] text-gray-500 px-1">
        흐름: <span className="text-gray-300">설명/속성 정리</span> → 스프라이트 → 씬 프리뷰(선택) → 보이스
      </p>

      <StepCard
        index={0}
        title="캐릭터 설명 & 속성"
        subtitle={desc.trim() ? "준비됨" : "설명을 먼저 입력하세요"}
        state={settingsState}
        open={openStep === 0}
        onToggle={() => setOpenStep(openStep === 0 ? null : 0)}
        action={
          <Button
            size="sm"
            variant="secondary"
            loading={saveSettings.isPending}
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              saveSettings.mutate();
            }}
          >
            저장
          </Button>
        }
      >
        <div className="space-y-3">
          <textarea
            className="input-base w-full resize-none h-20"
            placeholder="1girl, brown hair, bob cut, 30s, gentle expression, anime style..."
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
          <details className="rounded-lg border border-white/5 bg-black/10 p-2">
            <summary className="text-[11px] text-gray-400 font-semibold cursor-pointer flex items-center gap-1.5">
              <Settings2 className="w-3 h-3" /> 세부 속성
            </summary>
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Field label="배경색" value={backgroundColor} onChange={setBackgroundColor} />
                <Field label="Aesthetics" value={aesthetics} onChange={setAesthetics} />
                <Field label="성별" value={sex} onChange={setSex} />
                <NumField label="나이" value={age} onChange={setAge} />
                <Field label="종족" value={race} onChange={setRace} />
                <label className="flex items-center gap-2 text-[11px] text-gray-300 mt-5">
                  <input type="checkbox" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} />
                  NSFW
                </label>
                <Field label="Eyes" value={eyes} onChange={setEyes} />
                <Field label="Hair" value={hair} onChange={setHair} />
                <Field label="Face" value={face} onChange={setFace} />
                <Field label="Body" value={body} onChange={setBody} />
                <div className="col-span-2">
                  <Field label="Skin Color" value={skinColor} onChange={setSkinColor} />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-gray-400 mb-1 block">LoRA Prompt</label>
                <textarea className="input-base w-full resize-none h-12" value={loraPrompt} onChange={(e) => setLoraPrompt(e.target.value)} />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 mb-1 block">Negative Prompt</label>
                <textarea className="input-base w-full resize-none h-12" placeholder="worst quality, low quality, blurry, text, watermark..." value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumField label="너비" placeholder="832" value={resolutionW} onChange={setResolutionW} />
                <NumField label="높이" placeholder="1216" value={resolutionH} onChange={setResolutionH} />
              </div>
            </div>
          </details>
        </div>
      </StepCard>

      <StepCard
        index={1}
        title="스프라이트"
        subtitle={
          hasSprite
            ? "생성 완료"
            : spriteMode === "reference"
              ? hasReference
                ? "참조 이미지 사용 (Step 1.1 클론)"
                : "참조 이미지 업로드 필요"
              : "처음부터 생성 (Step 1)"
        }
        state={spriteState}
        open={openStep === 1}
        onToggle={() => setOpenStep(openStep === 1 ? null : 1)}
        action={
          <Button
            size="sm"
            variant="primary"
            loading={busy && task.kind === "sprite"}
            disabled={busy || !desc.trim() || (spriteMode === "reference" && !hasReference)}
            onClick={(e) => {
              e.stopPropagation();
              startSprite(spriteMode);
            }}
          >
            <Wand2 className="w-3 h-3" /> 생성
          </Button>
        }
      >
        <MiniTabs<"new" | "reference">
          value={spriteMode}
          onChange={setSpriteMode}
          tabs={[
            { value: "new", label: "신규 생성", hint: "VN Step1: 설명 프롬프트로 캐릭터 시트 생성" },
            { value: "reference", label: "참조 이미지", hint: "VN Step1.1: 업로드 이미지로 동일 캐릭터 시트 복제" },
          ]}
        />
        <div className="space-y-3">
          {spriteMode === "new" ? (
            <p className="text-[11px] text-gray-400">
              <span className="text-accent">VN Step1</span> 워크플로우로 0번 카드의 설명/속성에서 캐릭터 시트를 처음부터 생성합니다. 결과: 정면/측면/후면 + 표정 다수가 들어간 캐릭터 시트.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-gray-400">
                <span className="text-accent">VN Step1.1</span> 워크플로우로 업로드한 참조 이미지의 캐릭터를 같은 디자인으로 시트화합니다. 기존 일러스트나 다른 모델 결과물을 myaniform 파이프라인에 가져올 때 사용.
              </p>
              <div className="rounded-lg border border-white/5 bg-black/10 p-2 flex items-center gap-2">
                <p className="text-[11px] text-gray-400 flex-1">
                  {hasReference ? "참조 이미지 업로드됨" : "참조 이미지를 업로드하세요"}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || uploadReference.isPending}
                  loading={uploadReference.isPending}
                  onClick={() => referenceInputRef.current?.click()}
                >
                  <Upload className="w-3 h-3" /> {hasReference ? "교체" : "업로드"}
                </Button>
                <input
                  ref={referenceInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadReference.mutate(file);
                    e.target.value = "";
                  }}
                />
              </div>
            </>
          )}
          <details className="rounded-lg border border-white/5 bg-black/10 p-2">
            <summary className="text-[11px] text-gray-400 font-semibold cursor-pointer flex items-center gap-1.5">
              <Settings2 className="w-3 h-3" /> 스프라이트 파라미터
            </summary>
            <div className="mt-2">
              <ImageParamsEditor workflow="sdxl" value={spriteParams} onChange={setSpriteParams} />
            </div>
          </details>
        </div>
      </StepCard>

      <StepCard
        index={2}
        title="씬 프리뷰 (단독 컷)"
        subtitle={
          hasImage
            ? "생성 완료 — 의상/포즈/구도 다시 입혀 재생성 가능"
            : "스프라이트로 1컷 시뮬레이션. 씬에 들어갔을 때의 느낌 확인용"
        }
        state={imageState}
        open={openStep === 2}
        onToggle={() => setOpenStep(openStep === 2 ? null : 2)}
        action={
          <Button
            size="sm"
            variant="secondary"
            loading={busy && task.kind === "image"}
            disabled={busy || !hasSprite}
            onClick={(e) => {
              e.stopPropagation();
              startImage();
            }}
          >
            <ImageIcon className="w-3 h-3" /> 생성
          </Button>
        }
      >
        <p className="text-[11px] text-gray-400 mb-2">
          씬 이미지 워크플로우(Qwen Edit + 스프라이트 레퍼런스)로 캐릭터 단독 컷을 만듭니다. 스프라이트는 얼굴/머리/체형/팔레트를 잠그는 레퍼런스로 들어가고, <span className="text-accent">아래 의상/포즈/구도/카메라/조명/스타일을 채워야</span> 그게 실제 씬에서 어떻게 적용되는지 보입니다. 모두 비우면 모델이 레퍼런스를 그대로 재현하기만 해서 스프라이트가 살짝 변형된 것만 나옵니다.
        </p>
        <ImageParamsEditor
          workflow="qwen_edit"
          value={imageParams}
          onChange={setImageParams}
          showSceneDirection
        />
        <p className="text-[10px] text-gray-500 mt-2">
          실제 영상에 들어갈 장면샷은 씬 인스펙터에서 만듭니다. 여기는 캐릭터를 다양한 연출에 박아보고 싶을 때 쓰는 시뮬레이션 자리입니다.
        </p>
      </StepCard>

      <StepCard
        index={3}
        title="음성"
        subtitle={
          character.voice_sample_path
            ? "보이스 샘플 준비됨"
            : voiceMode === "design"
              ? "Voice Design (Qwen3): 텍스트 묘사로 생성"
              : "WAV 업로드: 외부 음성을 cloning 레퍼런스로 사용"
        }
        state={voiceState}
        open={openStep === 3}
        onToggle={() => setOpenStep(openStep === 3 ? null : 3)}
        action={
          voiceMode === "design" ? (
            <Button
              size="sm"
              variant="primary"
              loading={busy && task.kind === "voice"}
              disabled={busy || !voiceDesign.trim()}
              onClick={(e) => {
                e.stopPropagation();
                startVoice();
              }}
            >
              <Mic className="w-3 h-3" /> 생성
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={busy || uploadVoice.isPending}
              loading={uploadVoice.isPending}
              onClick={(e) => {
                e.stopPropagation();
                voiceInputRef.current?.click();
              }}
            >
              <Upload className="w-3 h-3" /> WAV 업로드
            </Button>
          )
        }
      >
        <input
          ref={voiceInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadVoice.mutate(file);
            e.target.value = "";
          }}
        />
        <MiniTabs<"design" | "upload">
          value={voiceMode}
          onChange={(mode) => {
            setVoiceMode(mode);
            // 모드가 곧 씬 대사 합성 엔진 — 디자인은 Qwen3, 업로드는 S2 Pro 가 기본 페어링.
            // 씬 단위로 다른 엔진을 쓰고 싶으면 씬 인스펙터에서 오버라이드.
            const tts_engine: "qwen3" | "s2pro" = mode === "design" ? "qwen3" : "s2pro";
            if (tts_engine !== character.tts_engine) {
              api.characters
                .update(projectId, character.id, { tts_engine })
                .then(onUpdated);
            }
          }}
          tabs={[
            { value: "design", label: "Voice Design — Qwen3", hint: "텍스트 묘사 → 새 보이스 샘플. 씬 합성도 Qwen3" },
            { value: "upload", label: "WAV 업로드 — S2 Pro", hint: "외부 음성 파일을 cloning 레퍼런스로. 씬 합성은 S2 Pro" },
          ]}
        />

        {voiceMode === "design" ? (
          <div className="space-y-3">
            <p className="text-[11px] text-gray-400">
              텍스트 묘사로 새 보이스 샘플을 만듭니다 (`Qwen3DirectedCloneFromVoiceDesign` 워크플로우).
              생성된 WAV 는 자동으로 캐릭터 보이스 샘플로 등록되어 씬 대사 합성 시 cloning 레퍼런스로 쓰입니다.
            </p>
            <textarea
              className="input-base w-full resize-none h-14"
              placeholder="calm Korean female voice, warm, gentle, 30s housewife"
              value={voiceDesign}
              onChange={(e) => setVoiceDesign(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
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
              <div>
                <label className="text-[11px] text-gray-400 mb-1 block">샘플 문장</label>
                <input
                  className="input-base w-full"
                  placeholder="안녕하세요. 오늘도 잘 부탁드려요."
                  value={voiceSampleText}
                  onChange={(e) => setVoiceSampleText(e.target.value)}
                />
              </div>
            </div>
            <details className="rounded-lg border border-white/5 bg-black/10 p-2">
              <summary className="text-[11px] text-gray-400 font-semibold cursor-pointer flex items-center gap-1.5">
                <Settings2 className="w-3 h-3" /> 보이스 파라미터
              </summary>
              <div className="mt-2">
                <VoiceParamsEditor value={voiceParams} onChange={setVoiceParams} />
              </div>
            </details>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-gray-400">
              외부 보이스 파일을 업로드해 cloning 레퍼런스로 등록합니다. 씬 대사 합성은 <span className="text-accent">Fish S2 Pro</span> 로 진행.
            </p>
            <p className="text-[10px] text-gray-500">
              지원 포맷: WAV, MP3, FLAC 등. 5~30초 분량 권장. 씬별로 다른 엔진을 쓰고 싶으면 씬 인스펙터에서 오버라이드 가능.
            </p>
          </div>
        )}
      </StepCard>

      <TaskProgress task={task} />
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[11px] text-gray-400 mb-1 block">{label}</label>
      <input className="input-base w-full" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function NumField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: number | "";
  onChange: (v: number | "") => void;
}) {
  return (
    <div>
      <label className="text-[11px] text-gray-400 mb-1 block">{label}</label>
      <input
        type="number"
        className="input-base w-full"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value ? parseInt(e.target.value) : "")}
      />
    </div>
  );
}
