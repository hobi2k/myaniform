import {
  DEFAULT_AUDIO_PRECISION,
  DEFAULT_MMAUDIO_MODEL,
  DEFAULT_PIX_FMT,
  DEFAULT_VIDEO_FORMAT,
  DEFAULT_VIDEO_SAMPLER,
  DEFAULT_VIDEO_SCHEDULER,
  MMAUDIO_MODELS,
  PIX_FMT_OPTIONS,
  PRECISION_OPTIONS,
  SAMPLER_OPTIONS,
  VIDEO_FORMAT_OPTIONS,
  VIDEO_SCHEDULER_OPTIONS,
} from "../../constants/modelCatalog";
import type { VideoParams } from "../../types";
import NumberParam from "./NumberParam";

interface Props {
  value: VideoParams;
  onChange: (p: VideoParams) => void;
}

export default function VideoParamsEditor({ value, onChange }: Props) {
  const set = (k: keyof VideoParams, v: number | string | boolean | undefined) => {
    const next: Record<string, unknown> = { ...value };
    if (v === "" || v === undefined) {
      delete next[k as string];
    } else {
      next[k as string] = v;
    }
    onChange(next as VideoParams);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <NumberParam label="steps" placeholder="자동" value={value.steps} onChange={(v) => set("steps", v)} />
        <NumberParam label="cfg" placeholder="자동" step="0.1" value={value.cfg} onChange={(v) => set("cfg", v)} />
        <NumberParam label="seed" placeholder="자동" value={value.seed} onChange={(v) => set("seed", v)} />
        <NumberParam label="frames" placeholder="81" value={value.frames} onChange={(v) => set("frames", v)} />
        <NumberParam label="fps" placeholder="16" value={value.fps} onChange={(v) => set("fps", v)} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-gray-500">sampler</label>
          <select className="input-base w-full" value={value.sampler ?? DEFAULT_VIDEO_SAMPLER} onChange={(e) => set("sampler", e.target.value)}>
            {SAMPLER_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-500">scheduler</label>
          <select className="input-base w-full" value={value.scheduler ?? DEFAULT_VIDEO_SCHEDULER} onChange={(e) => set("scheduler", e.target.value)}>
            {VIDEO_SCHEDULER_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <NumberParam label="shift" placeholder="5" step="0.1" value={value.shift} onChange={(v) => set("shift", v)} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <NumberParam label="video width" placeholder="832" value={value.width} onChange={(v) => set("width", v)} />
        <NumberParam label="video height" placeholder="480" value={value.height} onChange={(v) => set("height", v)} />
        <NumberParam label="S2V refiner start" placeholder="2" value={value.s2v_refiner_start_step} onChange={(v) => set("s2v_refiner_start_step", v)} />
        <NumberParam label="I2V refiner start" placeholder="3" value={value.i2v_refiner_start_step} onChange={(v) => set("i2v_refiner_start_step", v)} />
        <NumberParam label="audio offset sec" placeholder="0" step="0.1" value={value.s2v_audio_offset} onChange={(v) => set("s2v_audio_offset", v)} />
      </div>

      <details className="rounded-lg border border-cyan-300/10 bg-cyan-950/10 p-2">
        <summary className="text-[11px] text-cyan-200 font-semibold cursor-pointer">동작 / 음성 싱크</summary>
        <p className="text-[10px] text-gray-600 mt-1 mb-2">
          S2V는 입모양뿐 아니라 시선/머리/어깨/손/호흡까지 음성 박자에 맞춥니다. I2V도 보이스오버와 SFX 타이밍에 맞춰 움직임을 줍니다.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-gray-500">동작 프롬프트</label>
            <textarea className="input-base w-full resize-none h-16" placeholder="몸을 살짝 돌리고 손을 떼며 머리카락이 흔들림" value={value.motion_prompt ?? ""} onChange={(e) => set("motion_prompt", e.target.value || undefined)} />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">표정 / 제스처</label>
            <textarea className="input-base w-full resize-none h-16" placeholder="눈을 피했다가 다시 마주침, 짧은 숨" value={value.gesture_prompt ?? ""} onChange={(e) => set("gesture_prompt", e.target.value || undefined)} />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">카메라 움직임</label>
            <textarea className="input-base w-full resize-none h-16" placeholder="slow push-in, subtle handheld sway" value={value.camera_motion_prompt ?? ""} onChange={(e) => set("camera_motion_prompt", e.target.value || undefined)} />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">오디오 싱크 지시</label>
            <textarea className="input-base w-full resize-none h-16" placeholder="대사 박자에 맞춰 시선/고개/어깨 반응" value={value.audio_sync_prompt ?? ""} onChange={(e) => set("audio_sync_prompt", e.target.value || undefined)} />
          </div>
        </div>
        <div className="mt-2">
          <label className="text-[10px] text-gray-500">motion negative prompt</label>
          <textarea className="input-base w-full resize-none h-14" placeholder="static body, frozen pose, only lips moving..." value={value.motion_negative_prompt ?? ""} onChange={(e) => set("motion_negative_prompt", e.target.value || undefined)} />
        </div>
      </details>

      <div>
        <label className="text-[10px] text-gray-500">video negative prompt</label>
        <textarea className="input-base w-full resize-none h-12" placeholder="watermark, subtitles, static, blurry..." value={value.video_negative_prompt ?? ""} onChange={(e) => set("video_negative_prompt", e.target.value || undefined)} />
      </div>

      <details className="rounded-lg border border-white/5 bg-black/10 p-2">
        <summary className="text-[10px] text-gray-500 font-semibold cursor-pointer">비디오 출력</summary>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
          <div>
            <label className="text-[10px] text-gray-500">format</label>
            <select className="input-base w-full" value={value.video_format ?? DEFAULT_VIDEO_FORMAT} onChange={(e) => set("video_format", e.target.value)}>
              {VIDEO_FORMAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500">pix_fmt</label>
            <select className="input-base w-full" value={value.pix_fmt ?? DEFAULT_PIX_FMT} onChange={(e) => set("pix_fmt", e.target.value)}>
              {PIX_FMT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <NumberParam label="crf" placeholder="19" value={value.crf} onChange={(v) => set("crf", v)} />
          <NumberParam label="loop_count" placeholder="0" value={value.loop_count} onChange={(v) => set("loop_count", v)} />
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] text-gray-400">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={value.pingpong === true} onChange={(e) => set("pingpong", e.target.checked ? true : undefined)} />
            <span>pingpong</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={value.trim_to_audio === true} onChange={(e) => set("trim_to_audio", e.target.checked ? true : undefined)} />
            <span>trim to audio</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={value.save_output !== false} onChange={(e) => set("save_output", e.target.checked ? undefined : false)} />
            <span>save output</span>
          </label>
        </div>
      </details>

      <details className="rounded-lg border border-white/5 bg-black/10 p-2">
        <summary className="flex items-center gap-2 text-[10px] text-gray-500 font-semibold cursor-pointer">
          MMAudio SFX
          <label className="ml-auto flex items-center gap-1.5 text-[10px] text-gray-400" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={value.mmaudio_enabled !== false} onChange={(e) => set("mmaudio_enabled", e.target.checked)} />
            사용
          </label>
        </summary>
        <p className="text-[10px] text-gray-600 mt-1 mb-2">
          i2v는 최종 프레임에 SFX를 생성해 비디오 오디오로 붙이고, s2v는 TTS와 SFX를 믹스합니다.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <label className="text-[10px] text-gray-500">MMAudio 모델</label>
            <select className="input-base w-full" value={value.mmaudio_model ?? DEFAULT_MMAUDIO_MODEL} onChange={(e) => set("mmaudio_model", e.target.value || undefined)}>
              {MMAUDIO_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500">model precision</label>
            <select className="input-base w-full" value={value.mmaudio_precision ?? DEFAULT_AUDIO_PRECISION} onChange={(e) => set("mmaudio_precision", e.target.value)}>
              {PRECISION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500">feature precision</label>
            <select className="input-base w-full" value={value.mmaudio_feature_precision ?? DEFAULT_AUDIO_PRECISION} onChange={(e) => set("mmaudio_feature_precision", e.target.value)}>
              {PRECISION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500">negative prompt</label>
            <input className="input-base w-full" placeholder="talking, speech, music..." value={value.mmaudio_negative_prompt ?? ""} onChange={(e) => set("mmaudio_negative_prompt", e.target.value || undefined)} />
          </div>
          <NumberParam label="sfx duration" placeholder="5.0" step="0.1" value={value.mmaudio_duration} onChange={(v) => set("mmaudio_duration", v)} />
          <NumberParam label="sfx steps" placeholder="25" value={value.mmaudio_steps} onChange={(v) => set("mmaudio_steps", v)} />
          <NumberParam label="sfx cfg" placeholder="4.5" step="0.1" value={value.mmaudio_cfg} onChange={(v) => set("mmaudio_cfg", v)} />
          <NumberParam label="sfx seed" placeholder="자동" value={value.mmaudio_seed} onChange={(v) => set("mmaudio_seed", v)} />
          <NumberParam label="voice volume" placeholder="1.0" step="0.05" value={value.voice_volume} onChange={(v) => set("voice_volume", v)} />
          <NumberParam label="sfx volume" placeholder="0.35" step="0.05" value={value.sfx_volume} onChange={(v) => set("sfx_volume", v)} />
          <NumberParam label="sfx start sec" placeholder="0.0" step="0.05" value={value.sfx_start_time} onChange={(v) => set("sfx_start_time", v)} />
          <NumberParam label="audio output sec" placeholder="10" step="0.1" value={value.audio_output_duration} onChange={(v) => set("audio_output_duration", v)} />
          <NumberParam label="sfx fade in" placeholder="0.1" step="0.05" value={value.sfx_fade_in} onChange={(v) => set("sfx_fade_in", v)} />
          <NumberParam label="sfx fade out" placeholder="0.2" step="0.05" value={value.sfx_fade_out} onChange={(v) => set("sfx_fade_out", v)} />
          <NumberParam label="audio crop sec" placeholder="5" step="0.1" value={value.s2v_audio_duration} onChange={(v) => set("s2v_audio_duration", v)} />
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] text-gray-400">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={value.mmaudio_mask_away_clip === true} onChange={(e) => set("mmaudio_mask_away_clip", e.target.checked ? true : undefined)} />
            <span>mask away CLIP</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={value.mmaudio_force_offload !== false} onChange={(e) => set("mmaudio_force_offload", e.target.checked ? undefined : false)} />
            <span>force offload</span>
          </label>
        </div>
      </details>
    </div>
  );
}
