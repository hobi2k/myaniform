import { Expand, Image as ImageIcon, Mic, Sparkles, User, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { assetUrl } from "../../lib/json";
import type { Character, Scene } from "../../types";

interface CharProps {
  kind: "character";
  character: Character;
  assetVersion: number;
}
interface SceneProps {
  kind: "scene";
  scene: Scene;
  assetVersion: number;
}
interface EmptyProps {
  kind: "empty";
}

type Props = CharProps | SceneProps | EmptyProps;

type CharTab = "sprite" | "image" | "reference";
type SceneTab = "video" | "image";

export default function PreviewPanel(props: Props) {
  if (props.kind === "empty") return <EmptyState />;
  if (props.kind === "character") return <CharacterPreview character={props.character} assetVersion={props.assetVersion} />;
  return <ScenePreview scene={props.scene} assetVersion={props.assetVersion} />;
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-sm gap-3 p-8">
      <Sparkles className="w-10 h-10 text-gray-700" />
      <p>왼쪽에서 캐릭터나 씬을 선택하세요.</p>
      <p className="text-[11px] text-gray-600 max-w-xs text-center">
        흐름: 캐릭터 스프라이트 생성 → 씬에서 캐릭터를 골라 장면샷 생성 → 영상 생성 → 편집 스튜디오에서 합치기.
      </p>
    </div>
  );
}

function CharacterPreview({ character, assetVersion }: { character: Character; assetVersion: number }) {
  const hasSprite = !!character.sprite_path;
  const hasImage = !!character.image_path && character.image_path.includes("_generated");
  const hasReference = !!character.image_path && !hasImage;

  const initialTab: CharTab = hasSprite ? "sprite" : hasReference ? "reference" : hasImage ? "image" : "sprite";
  const [tab, setTab] = useState<CharTab>(initialTab);

  const currentPath =
    tab === "sprite" && hasSprite ? character.sprite_path
    : tab === "reference" && hasReference ? character.image_path
    : tab === "image" && hasImage ? character.image_path
    : null;

  return (
    <div className="flex-1 flex flex-col p-4 min-h-0 min-w-0">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-sm font-semibold text-gray-200 truncate">{character.name}</h3>
        <div className="flex gap-1 flex-shrink-0">
          <PreviewTab active={tab === "sprite"} onClick={() => setTab("sprite")} disabled={!hasSprite}>
            <User className="w-3 h-3" /> 스프라이트
          </PreviewTab>
          <PreviewTab active={tab === "reference"} onClick={() => setTab("reference")} disabled={!hasReference}>
            <ImageIcon className="w-3 h-3" /> 참조
          </PreviewTab>
          <PreviewTab active={tab === "image"} onClick={() => setTab("image")} disabled={!hasImage}>
            <ImageIcon className="w-3 h-3" /> 씬 프리뷰
          </PreviewTab>
        </div>
      </div>

      <ImageStage
        path={currentPath}
        version={assetVersion}
        emptyIcon={<User className="w-12 h-12 opacity-30" />}
        emptyText="아직 생성된 자산이 없습니다."
      />

      {character.voice_sample_path && (
        <div className="mt-3 rounded-lg border border-white/5 bg-black/20 p-2 flex items-center gap-2">
          <Mic className="w-3.5 h-3.5 text-emerald-300 flex-shrink-0" />
          <span className="text-[11px] text-gray-400 flex-shrink-0">보이스 샘플</span>
          <audio
            src={assetUrl(character.voice_sample_path, assetVersion)}
            controls
            className="flex-1 h-7 min-w-0"
          />
        </div>
      )}
    </div>
  );
}

function ScenePreview({ scene, assetVersion }: { scene: Scene; assetVersion: number }) {
  const hasVideo = !!scene.clip_path;
  const hasImage = !!scene.image_path;
  const initial: SceneTab = hasVideo ? "video" : "image";
  const [tab, setTab] = useState<SceneTab>(initial);
  const [zoomImage, setZoomImage] = useState(false);

  return (
    <div className="flex-1 flex flex-col p-4 min-h-0 min-w-0">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-sm font-semibold text-gray-200 truncate min-w-0">
          씬 #{scene.order + 1}
          <span className="ml-2 text-[10px] text-gray-500 font-normal">
            {scene.type} · {scene.bg_prompt?.slice(0, 40) || "프롬프트 없음"}
          </span>
        </h3>
        <div className="flex gap-1 flex-shrink-0">
          <PreviewTab active={tab === "video"} onClick={() => setTab("video")} disabled={!hasVideo}>
            <Video className="w-3 h-3" /> 영상
          </PreviewTab>
          <PreviewTab active={tab === "image"} onClick={() => setTab("image")} disabled={!hasImage}>
            <ImageIcon className="w-3 h-3" /> 장면샷
          </PreviewTab>
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-lg bg-surface-sunken border border-white/5 overflow-hidden relative">
        {tab === "video" && hasVideo ? (
          <video
            src={assetUrl(scene.clip_path, assetVersion)}
            controls
            className="absolute inset-0 w-full h-full object-contain"
          />
        ) : tab === "image" && hasImage ? (
          <div
            onClick={() => setZoomImage(true)}
            className="absolute inset-0 group cursor-zoom-in"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setZoomImage(true);
            }}
            title="확대 보기"
          >
            <img
              src={assetUrl(scene.image_path, assetVersion, "/comfy_input/")}
              alt=""
              className="absolute inset-0 w-full h-full object-contain"
            />
            <span className="absolute top-2 right-2 p-1.5 rounded-md bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity z-10">
              <Expand className="w-3.5 h-3.5" />
            </span>
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-center text-gray-600 text-xs">
            <div>
              <Video className="w-12 h-12 opacity-30 mx-auto mb-2" />
              아직 생성된 영상/이미지가 없습니다.
            </div>
          </div>
        )}
      </div>

      {scene.voice_path && (
        <div className="mt-3 rounded-lg border border-white/5 bg-black/20 p-2 flex items-center gap-2">
          <Mic className="w-3.5 h-3.5 text-emerald-300 flex-shrink-0" />
          <span className="text-[11px] text-gray-400 flex-shrink-0">씬 음성</span>
          <audio
            src={assetUrl(scene.voice_path, assetVersion, "/comfy_input/")}
            controls
            className="flex-1 h-7 min-w-0"
          />
        </div>
      )}

      {zoomImage && hasImage && (
        <FullscreenImage
          src={assetUrl(scene.image_path, assetVersion, "/comfy_input/")}
          onClose={() => setZoomImage(false)}
        />
      )}
    </div>
  );
}

/**
 * Preview area for a single image asset. Click → fullscreen viewer.
 * In-pane: object-contain shrink-to-fit (so even tall sprite sheets show entirely).
 * Hover: shows expand affordance.
 */
function ImageStage({
  path,
  version,
  prefix = "/",
  emptyIcon,
  emptyText,
}: {
  path: string | null;
  version: number;
  prefix?: string;
  emptyIcon: React.ReactNode;
  emptyText: string;
}) {
  const [zoom, setZoom] = useState(false);

  if (!path) {
    return (
      <div className="flex-1 min-h-0 rounded-lg bg-surface-sunken border border-white/5 grid place-items-center overflow-hidden">
        <div className="text-center text-gray-600 text-xs">
          <div className="mx-auto mb-2 w-fit">{emptyIcon}</div>
          {emptyText}
        </div>
      </div>
    );
  }

  // Container uses absolute-positioned img so the image is always
  // strictly bounded by the container size (object-fit: contain shrinks to fit).
  // This is more robust than max-w/h-full inside a button-with-flex-children.
  return (
    <>
      <div
        onClick={() => setZoom(true)}
        className="flex-1 min-h-0 rounded-lg bg-surface-sunken border border-white/5 overflow-hidden group relative cursor-zoom-in"
        title="클릭하면 원본 크기로 확대"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setZoom(true);
        }}
      >
        <img
          src={assetUrl(path, version, prefix)}
          alt=""
          className="absolute inset-0 w-full h-full object-contain"
        />
        <span className="absolute top-2 right-2 p-1.5 rounded-md bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <Expand className="w-3.5 h-3.5" />
        </span>
      </div>
      {zoom && <FullscreenImage src={assetUrl(path, version, prefix)} onClose={() => setZoom(false)} />}
    </>
  );
}

/**
 * Fullscreen image viewer. Image renders at natural size; drag with mouse/touch
 * (pointer events) to pan around. Esc or X button to close.
 */
function FullscreenImage({ src, onClose }: { src: string; onClose: () => void }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ pointerX: 0, pointerY: 0, baseX: 0, baseY: 0 });

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Recenter when src swaps
  useEffect(() => {
    setPos({ x: 0, y: 0 });
  }, [src]);

  // Release drag if pointer is released anywhere (incl. outside the window)
  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging]);

  const onPointerDown = (e: React.PointerEvent) => {
    // Left button only
    if (e.button !== 0) return;
    setDragging(true);
    dragStart.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      baseX: pos.x,
      baseY: pos.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.current.pointerX;
    const dy = e.clientY - dragStart.current.pointerY;
    setPos({ x: dragStart.current.baseX + dx, y: dragStart.current.baseY + dy });
  };

  const recenter = () => setPos({ x: 0, y: 0 });

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm overflow-hidden">
      <button
        type="button"
        className="absolute top-4 right-4 z-10 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white"
        onClick={onClose}
        title="닫기 (Esc)"
      >
        <X className="w-5 h-5" />
      </button>
      <button
        type="button"
        className="absolute top-4 right-16 z-10 px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white text-[11px]"
        onClick={recenter}
        title="중앙 정렬"
      >
        중앙
      </button>
      <span className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-2 py-1 rounded-md bg-white/10 text-white/70 text-[11px] pointer-events-none">
        드래그하여 이동 · Esc 로 닫기
      </span>
      <div
        className="absolute inset-0 flex items-center justify-center select-none touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        style={{ cursor: dragging ? "grabbing" : "grab" }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="max-w-none rounded-lg border border-white/20 shadow-2xl"
          style={{
            transform: `translate(${pos.x}px, ${pos.y}px)`,
            transition: dragging ? "none" : "transform 0.15s ease-out",
            userSelect: "none",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}

function PreviewTab({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-all ${
        active
          ? "bg-accent-muted border-accent/40 text-white"
          : "bg-transparent border-white/10 text-gray-400 hover:text-white hover:border-white/20"
      } disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}
