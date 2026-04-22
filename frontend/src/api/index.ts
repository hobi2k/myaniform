import type { Character, DiffusionModelList, LoraEntry, Project, Scene } from "../types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "API 오류");
  }
  return res.json();
}

// ── Projects ──────────────────────────────────────────────────

export const api = {
  projects: {
    list: () => request<Project[]>("/projects"),
    get: (id: string) => request<Project>(`/projects/${id}`),
    create: (data: { title: string; episode?: string }) =>
      request<Project>("/projects", { method: "POST", body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<void>(`/projects/${id}`, { method: "DELETE" }),
  },

  characters: {
    list: (projectId: string) =>
      request<Character[]>(`/projects/${projectId}/characters`),
    create: (projectId: string, data: { name: string; description?: string }) =>
      request<Character>(`/projects/${projectId}/characters`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (projectId: string, charId: string, data: Partial<Character>) =>
      request<Character>(`/projects/${projectId}/characters/${charId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    delete: (projectId: string, charId: string) =>
      request<void>(`/projects/${projectId}/characters/${charId}`, { method: "DELETE" }),

    uploadImage: (projectId: string, charId: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${BASE}/projects/${projectId}/characters/${charId}/image/upload`, {
        method: "POST",
        body: form,
      }).then((r) => r.json() as Promise<Character>);
    },

    generateImage: (projectId: string, charId: string) =>
      request<Character>(`/projects/${projectId}/characters/${charId}/image/generate`, {
        method: "POST",
      }),

    uploadVoice: (projectId: string, charId: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${BASE}/projects/${projectId}/characters/${charId}/voice/upload`, {
        method: "POST",
        body: form,
      }).then((r) => r.json() as Promise<Character>);
    },

    designVoice: (projectId: string, charId: string, voiceDesign: string) =>
      request<Character>(`/projects/${projectId}/characters/${charId}/voice/design`, {
        method: "POST",
        body: JSON.stringify({ voice_design: voiceDesign }),
      }),

    // Phase 4: VNCCS 캐릭터 시트 / 스프라이트
    generateSheet: (projectId: string, charId: string) =>
      request<Character>(`/projects/${projectId}/characters/${charId}/sheet/generate`, {
        method: "POST",
      }),
    uploadSheet: (projectId: string, charId: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${BASE}/projects/${projectId}/characters/${charId}/sheet/upload`, {
        method: "POST",
        body: form,
      }).then((r) => r.json() as Promise<Character>);
    },
    uploadSprite: (projectId: string, charId: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${BASE}/projects/${projectId}/characters/${charId}/sprite/upload`, {
        method: "POST",
        body: form,
      }).then((r) => r.json() as Promise<Character>);
    },
  },

  scenes: {
    list: (projectId: string) =>
      request<Scene[]>(`/projects/${projectId}/scenes`),
    create: (projectId: string, data: Partial<Scene>) =>
      request<Scene>(`/projects/${projectId}/scenes`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (projectId: string, sceneId: string, data: Partial<Scene>) =>
      request<Scene>(`/projects/${projectId}/scenes/${sceneId}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    delete: (projectId: string, sceneId: string) =>
      request<void>(`/projects/${projectId}/scenes/${sceneId}`, { method: "DELETE" }),
    reorder: (projectId: string, order: string[]) =>
      request<void>(`/projects/${projectId}/scenes/reorder`, {
        method: "POST",
        body: JSON.stringify({ order }),
      }),
    regenerateVoice: (projectId: string, sceneId: string) =>
      request<Scene>(`/projects/${projectId}/scenes/${sceneId}/regenerate/voice`, {
        method: "POST",
      }),
    regenerateImage: (projectId: string, sceneId: string) =>
      request<Scene>(`/projects/${projectId}/scenes/${sceneId}/regenerate/image`, {
        method: "POST",
      }),
    regenerateVideo: (projectId: string, sceneId: string) =>
      request<Scene>(`/projects/${projectId}/scenes/${sceneId}/regenerate/video`, {
        method: "POST",
      }),
    uploadImage: (projectId: string, sceneId: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return fetch(`${BASE}/projects/${projectId}/scenes/${sceneId}/image/upload`, {
        method: "POST",
        body: form,
      }).then((r) => r.json() as Promise<Scene>);
    },
  },

  loras: {
    list: () =>
      fetch("/api/setup/loras")
        .then((r) => r.json())
        .then((j: { loras: LoraEntry[] }) => j.loras),
  },

  diffusionModels: {
    list: () => request<DiffusionModelList>("/setup/diffusion_models"),
  },

  setup: {
    comfyStatus: () =>
      request<{ online: boolean; url: string; detail?: string }>("/setup/comfy_status"),
  },
};
