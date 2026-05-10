import { useMutation } from "@tanstack/react-query";
import { Image as ImageIcon, Mic, Settings2, Upload, User, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { DEFAULT_IMAGE_PARAMS } from "../../constants/modelCatalog";
import { useGenerationStream } from "../../hooks/useGenerationStream";
import { parseJson } from "../../lib/json";
import type { Character, ImageParams, VoiceGenParams, VoiceSource } from "../../types";
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
  const spriteReplaceRef = useRef<HTMLInputElement>(null);
  const imageReplaceRef = useRef<HTMLInputElement>(null);
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
  const [timbreStrength, setTimbreStrength] = useState<number>(0.72);
  const [anchorSpeaker, setAnchorSpeaker] = useState<string>("auto");

  const [openStep, setOpenStep] = useState<number | null>(0);
  const [spriteMode, setSpriteMode] = useState<"new" | "reference">(
    character.image_path && !character.image_path.includes("_generated") ? "reference" : "new",
  );
  const [voiceMode, setVoiceMode] = useState<VoiceSource>(
    (character.voice_source === "upload" || character.voice_source === "design")
      ? character.voice_source
      : (character.voice_sample_path
          ? (character.tts_engine === "s2pro" && !character.voice_design ? "upload" : "design")
          : "design"),
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
    setVoiceMode(
      (character.voice_source === "upload" || character.voice_source === "design")
        ? character.voice_source
        : (character.voice_sample_path
            ? (character.tts_engine === "s2pro" && !character.voice_design ? "upload" : "design")
            : "design"),
    );
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
      voice_source: voiceMode,
    });

  const saveSettings = useMutation({
    mutationFn: persistAll,
    onSuccess: onUpdated,
  });

  const uploadReference = useMutation({
    mutationFn: (file: File) => api.characters.uploadReferenceImage(projectId, character.id, file),
    onSuccess: onUpdated,
  });

  const uploadSpriteReplace = useMutation({
    mutationFn: (file: File) => api.characters.uploadSprite(projectId, character.id, file),
    onSuccess: onUpdated,
  });

  const uploadImageReplace = useMutation({
    mutationFn: (file: File) => api.characters.uploadImage(projectId, character.id, file),
    onSuccess: onUpdated,
  });

  const uploadVoice = useMutation({
    mutationFn: (file: File) => api.characters.uploadVoice(projectId, character.id, file),
    onSuccess: onUpdated,
  });

  const startVoiceboxRegister = () =>
    run({
      kind: "voice",
      label: "VoiceBox 화자 등록 (영구 음색 baking)",
      url: `/api/projects/${projectId}/characters/${character.id}/voice/voicebox/register/stream`,
      body: { timbre_strength: timbreStrength, anchor_speaker: anchorSpeaker },
      payloadField: "character",
      beforeStart: async () => {
        await persistAll();
      },
      onComplete: onUpdated,
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
  const hasVoiceSample = !!character.voice_sample_path;
  const voiceboxRegistered = !!(character.voicebox_checkpoint && character.voicebox_speaker);
  const voiceState: StepState =
    busy && task.kind === "voice"
      ? "running"
      : hasVoiceSample
        ? "done"  // baseline 확보됨. 등록은 선택 — done 으로 침.
        : (voiceMode === "design" && voiceDesign.trim()) ? "ready" : "todo";

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
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              title="외부 편집본 업로드 — AI 결과 교체"
              disabled={busy || uploadSpriteReplace.isPending}
              loading={uploadSpriteReplace.isPending}
              onClick={(e) => {
                e.stopPropagation();
                spriteReplaceRef.current?.click();
              }}
            >
              <Upload className="w-3 h-3" />
            </Button>
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
          </div>
        }
      >
        <input
          ref={spriteReplaceRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadSpriteReplace.mutate(file);
            e.target.value = "";
          }}
        />
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
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              title="외부 편집본 업로드 — AI 결과 교체"
              disabled={busy || uploadImageReplace.isPending}
              loading={uploadImageReplace.isPending}
              onClick={(e) => {
                e.stopPropagation();
                imageReplaceRef.current?.click();
              }}
            >
              <Upload className="w-3 h-3" />
            </Button>
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
          </div>
        }
      >
        <input
          ref={imageReplaceRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadImageReplace.mutate(file);
            e.target.value = "";
          }}
        />
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
          hasVoiceSample
            ? voiceboxRegistered
              ? `Baseline + 모델 등록 완료 (${character.voicebox_speaker})`
              : voiceMode === "design"
                ? "Voice Design WAV 준비됨 — 모델 등록 권장"
                : "WAV 업로드됨 — 모델 등록 권장"
            : voiceMode === "design"
              ? "Voice Design: 텍스트 묘사로 baseline WAV 생성"
              : "WAV 업로드: 외부 음성을 baseline 으로"
        }
        state={voiceState}
        open={openStep === 3}
        onToggle={() => setOpenStep(openStep === 3 ? null : 3)}
        action={
          voiceMode === "design" ? (
            <Button
              size="sm"
              variant="primary"
              loading={busy && task.kind === "voice" && !hasVoiceSample}
              disabled={busy || !voiceDesign.trim()}
              onClick={(e) => {
                e.stopPropagation();
                startVoice();
              }}
            >
              <Mic className="w-3 h-3" /> {hasVoiceSample ? "재생성" : "생성"}
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
        <p className="text-[11px] text-gray-400 mb-2">
          1) <span className="text-accent">baseline WAV</span> 를 만들고 → 2) <span className="text-accent">"모델에 영구 등록"</span> 버튼으로 그 음색을 Qwen3 모델 ckpt 안에 named speaker 로 굽습니다 (`Qwen3VoiceBoxMorphSpeaker`).
          등록 후에는 씬 합성이 ref 없이 이름만으로 호출되어 일관된 음색 + 빠른 합성이 됩니다.
        </p>
        <MiniTabs<VoiceSource>
          value={voiceMode}
          onChange={(mode) => {
            setVoiceMode(mode);
            // tts_engine 페어링: design 은 Qwen3, upload 는 S2-Pro 기본.
            // 씬 단위로 오버라이드 가능. voicebox 등록되면 Qwen3 만 의미 있음.
            const tts_engine: "qwen3" | "s2pro" = mode === "upload" ? "s2pro" : "qwen3";
            if (tts_engine !== character.tts_engine) {
              api.characters
                .update(projectId, character.id, { tts_engine })
                .then(onUpdated);
            }
          }}
          tabs={[
            { value: "design", label: "Voice Design", hint: "텍스트 묘사 → Qwen3 가 baseline WAV 합성" },
            { value: "upload", label: "WAV 업로드", hint: "외부 음성 파일을 baseline 으로 사용" },
          ]}
        />

        {voiceMode === "design" && (
          <div className="space-y-3 mt-2">
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
                <Settings2 className="w-3 h-3" /> 보이스 생성 파라미터
              </summary>
              <div className="mt-2">
                <VoiceParamsEditor value={voiceParams} onChange={setVoiceParams} />
              </div>
            </details>
          </div>
        )}

        {voiceMode === "upload" && (
          <div className="space-y-2 mt-2">
            <p className="text-[10px] text-gray-500">지원 포맷: WAV / MP3 / FLAC. 5~30초 분량 권장. 업로드된 음원은 그대로 baseline 이 됩니다.</p>
          </div>
        )}

        {/* ── 모델 영구 등록 (morph) ────────────────────────────────────── */}
        <div className={`rounded-lg border p-2 mt-3 ${voiceboxRegistered ? "border-accent/40 bg-accent/5" : "border-white/10 bg-black/20"}`}>
          <div className="flex items-center gap-2">
            <Mic className="w-3.5 h-3.5 text-accent shrink-0" />
            <div className="text-[11px] text-gray-300 font-semibold flex-1">
              {voiceboxRegistered ? "모델에 영구 등록됨" : "모델에 영구 등록 (선택 · 권장)"}
            </div>
            <Button
              size="sm"
              variant={voiceboxRegistered ? "secondary" : "primary"}
              loading={busy && task.kind === "voice" && hasVoiceSample}
              disabled={busy || !hasVoiceSample}
              onClick={() => startVoiceboxRegister()}
            >
              {voiceboxRegistered ? "재등록" : "등록"}
            </Button>
          </div>
          <p className="text-[10px] text-gray-500 mt-1">
            baseline WAV 의 speaker embedding 을 anchor 화자와 보간 후 모델 ckpt 의 빈 슬롯에 한 행 써서 named speaker 로 굽습니다 (`Qwen3VoiceBoxMorphSpeaker`).
            이후 씬 인스펙터의 <span className="text-accent">VoiceBox · Named Speaker</span> 모드가 ref audio 없이 이름만으로 즉시 합성합니다.
          </p>
          {voiceboxRegistered && (
            <p className="text-[10px] text-gray-500 mt-1">
              speaker = <span className="text-gray-300">{character.voicebox_speaker}</span> · ckpt = <span className="text-gray-400 break-all">{character.voicebox_checkpoint}</span>
            </p>
          )}
          {!hasVoiceSample && (
            <p className="text-[10px] text-amber-300 mt-1">먼저 baseline WAV 를 준비해야 등록할 수 있습니다.</p>
          )}
          <details className="mt-2">
            <summary className="text-[10px] text-gray-500 cursor-pointer">고급 옵션 (timbre_strength / anchor)</summary>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <div>
                <label className="text-[10px] text-gray-500 block">timbre_strength (0=anchor, 1=ref)</label>
                <input
                  type="number" min={0} max={1} step={0.01}
                  className="input-base w-full"
                  value={timbreStrength}
                  onChange={(e) => setTimbreStrength(parseFloat(e.target.value))}
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block">anchor_speaker</label>
                <input
                  className="input-base w-full"
                  placeholder="auto"
                  value={anchorSpeaker}
                  onChange={(e) => setAnchorSpeaker(e.target.value)}
                />
              </div>
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              0.72 가 기본. 너무 낮으면 anchor 화자 톤이 묻어나고, 너무 높으면 ref audio 노이즈까지 따라옵니다. anchor 는 언어별 적합한 빌트인 화자로 자동 선택.
            </p>
          </details>
        </div>
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
