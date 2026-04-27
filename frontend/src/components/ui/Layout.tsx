import { useQuery } from "@tanstack/react-query";
import { Clapperboard } from "lucide-react";
import { Link, Outlet } from "react-router-dom";
import { api } from "../../api";
import { comfyUiUrl } from "../../utils/hosts";

export default function Layout() {
  const { data: comfyStatus } = useQuery({
    queryKey: ["comfy-status"],
    queryFn: () => api.setup.comfyStatus(),
    refetchInterval: 5000,
  });
  const comfyHref = comfyUiUrl();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-surface-raised/80 backdrop-blur-md border-b border-white/5 px-6 py-3 flex items-center gap-3 sticky top-0 z-40">
        <Link
          to="/"
          className="flex items-center gap-2 font-semibold text-lg group"
        >
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent-hover grid place-items-center shadow-lg shadow-accent/20">
            <Clapperboard className="w-4 h-4 text-white" />
          </span>
          <span className="bg-gradient-to-r from-white to-accent bg-clip-text text-transparent group-hover:from-accent group-hover:to-white transition-all">
            myaniform
          </span>
        </Link>
        <span className="text-[11px] text-gray-500 ml-1 hidden sm:inline">
          애니풍 멀티샷 제작 스튜디오
        </span>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full border ${
            comfyStatus?.online
              ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
              : "text-red-300 border-red-500/30 bg-red-500/10"
          }`}
          title={comfyStatus?.online ? "ComfyUI 연결됨" : comfyStatus?.detail ?? "ComfyUI 연결 안 됨"}
        >
          {comfyStatus?.online ? "ComfyUI ON" : "ComfyUI OFF"}
        </span>
        <div className="flex-1" />
        <a
          href="/workflows"
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-gray-500 hover:text-accent transition-colors"
        >
          워크플로우 ↗
        </a>
        <a
          href={comfyHref}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-gray-500 hover:text-accent transition-colors"
        >
          ComfyUI ↗
        </a>
      </header>
      <main className="flex-1 container mx-auto px-4 py-6 max-w-6xl">
        <Outlet />
      </main>
    </div>
  );
}
