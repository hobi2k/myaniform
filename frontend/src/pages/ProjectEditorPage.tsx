import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import CharacterInspector from "../components/editor/CharacterInspector";
import EditorShell from "../components/editor/EditorShell";
import LibraryPanel, { type Selection } from "../components/editor/LibraryPanel";
import PipelineStatusBar from "../components/editor/PipelineStatusBar";
import PreviewPanel from "../components/editor/PreviewPanel";
import SceneInspector from "../components/editor/SceneInspector";
import TimelineStrip from "../components/editor/TimelineStrip";
import type { Character, Scene, SceneType } from "../types";

export default function ProjectEditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.projects.get(projectId!),
    enabled: !!projectId,
  });
  const charactersQuery = useQuery({
    queryKey: ["characters", projectId],
    queryFn: () => api.characters.list(projectId!),
    enabled: !!projectId,
  });
  const scenesQuery = useQuery({
    queryKey: ["scenes", projectId],
    queryFn: () => api.scenes.list(projectId!),
    enabled: !!projectId,
  });

  const characters = charactersQuery.data ?? [];
  const scenes = scenesQuery.data ?? [];

  const [selection, setSelection] = useState<Selection>(null);
  const [assetVersion, setAssetVersion] = useState(() => Date.now());

  // Auto-select first available entity once data lands.
  useEffect(() => {
    if (selection) return;
    if (characters.length > 0) setSelection({ kind: "character", id: characters[0].id });
    else if (scenes.length > 0) setSelection({ kind: "scene", id: scenes[0].id });
  }, [selection, characters, scenes]);

  const createCharacter = useMutation({
    mutationFn: (name: string) => api.characters.create(projectId!, { name }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["characters", projectId] });
      setSelection({ kind: "character", id: c.id });
    },
  });

  const deleteCharacter = useMutation({
    mutationFn: (id: string) => api.characters.delete(projectId!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["characters", projectId] });
      if (selection?.kind === "character") setSelection(null);
    },
  });

  const createScene = useMutation({
    mutationFn: (type: SceneType) =>
      api.scenes.create(projectId!, {
        type,
        order: scenes.length,
        bg_prompt: "",
        sfx_prompt: "",
        frame_source_mode: "new_scene",
      }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["scenes", projectId] });
      setSelection({ kind: "scene", id: s.id });
    },
  });

  const deleteScene = useMutation({
    mutationFn: (id: string) => api.scenes.delete(projectId!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scenes", projectId] });
      if (selection?.kind === "scene") setSelection(null);
    },
  });

  const reorderScenes = useMutation({
    mutationFn: (order: string[]) => api.scenes.reorder(projectId!, order),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenes", projectId] }),
  });

  const onCharacterUpdated = (c: Character) => {
    setAssetVersion(Date.now());
    qc.setQueryData<Character[]>(["characters", projectId], (prev) =>
      prev ? prev.map((x) => (x.id === c.id ? c : x)) : prev,
    );
  };

  const onSceneUpdated = (s: Scene) => {
    setAssetVersion(Date.now());
    qc.setQueryData<Scene[]>(["scenes", projectId], (prev) =>
      prev ? prev.map((x) => (x.id === s.id ? s : x)) : prev,
    );
  };

  const selectedCharacter = useMemo(
    () => (selection?.kind === "character" ? characters.find((c) => c.id === selection.id) ?? null : null),
    [selection, characters],
  );
  const selectedScene = useMemo(
    () => (selection?.kind === "scene" ? scenes.find((s) => s.id === selection.id) ?? null : null),
    [selection, scenes],
  );
  const selectedSceneIndex = useMemo(
    () => (selectedScene ? scenes.findIndex((s) => s.id === selectedScene.id) : -1),
    [selectedScene, scenes],
  );

  if (projectQuery.isLoading) {
    return <div className="text-gray-400 text-sm py-6">불러오는 중...</div>;
  }
  if (!projectQuery.data || !projectId) {
    return (
      <div className="text-center py-20 text-gray-500">
        <p>프로젝트를 찾을 수 없습니다.</p>
        <Link to="/" className="text-accent text-sm mt-2 inline-block hover:underline">
          목록으로
        </Link>
      </div>
    );
  }

  const project = projectQuery.data;

  return (
    <EditorShell
      header={
        <PipelineStatusBar
          project={project}
          characters={characters}
          scenes={scenes}
          projectId={projectId}
        />
      }
      library={
        <LibraryPanel
          characters={characters}
          scenes={scenes}
          selection={selection}
          assetVersion={assetVersion}
          onSelect={setSelection}
          onCreateCharacter={(name) => createCharacter.mutate(name)}
          onDeleteCharacter={(id) => deleteCharacter.mutate(id)}
          onCreateScene={(t) => createScene.mutate(t)}
          onDeleteScene={(id) => deleteScene.mutate(id)}
          onReorderScenes={(order) => reorderScenes.mutate(order)}
        />
      }
      preview={
        selectedCharacter ? (
          <PreviewPanel kind="character" character={selectedCharacter} assetVersion={assetVersion} />
        ) : selectedScene ? (
          <PreviewPanel kind="scene" scene={selectedScene} assetVersion={assetVersion} />
        ) : (
          <PreviewPanel kind="empty" />
        )
      }
      inspector={
        selectedCharacter ? (
          <CharacterInspector
            key={selectedCharacter.id}
            projectId={projectId}
            character={selectedCharacter}
            onUpdated={onCharacterUpdated}
          />
        ) : selectedScene ? (
          <SceneInspector
            key={selectedScene.id}
            projectId={projectId}
            scene={selectedScene}
            sceneIndex={selectedSceneIndex}
            characters={characters}
            onUpdated={onSceneUpdated}
            onDelete={() => deleteScene.mutate(selectedScene.id)}
          />
        ) : (
          <div className="p-6 text-center text-xs text-gray-500">
            왼쪽에서 캐릭터나 씬을 선택하면 인스펙터가 여기에 나타납니다.
          </div>
        )
      }
      timeline={
        <TimelineStrip
          scenes={scenes}
          selection={selection}
          assetVersion={assetVersion}
          onSelect={setSelection}
          onReorder={(order) => reorderScenes.mutate(order)}
        />
      }
    />
  );
}
