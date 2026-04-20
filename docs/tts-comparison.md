# TTS 비교: QWEN3-TTS vs Fish Audio S2 Pro

---

## 요약

| 항목 | QWEN3-TTS | Fish Audio S2 Pro |
|------|-----------|-------------------|
| 라이선스 | Apache 2.0 (완전 오픈) | 별도 라이선스 |
| 로컬 실행 | O | O |
| 한국어 | O (공식 10개 언어) | O (다국어) |
| 보이스 클론 | O (레퍼런스 WAV) | O (레퍼런스 WAV) |
| 보이스 설계 | O (텍스트 설명) | X |
| 감정 태그 | X | O (`[breath]`, `[pause]` 등) |
| 멀티스피커 | X | O (화자 2인 동시) |
| ComfyUI 노드 | Qwen3Loader 계열 | FishS2* 계열 |

---

## QWEN3-TTS

### 모드

**VoiceClone**: 레퍼런스 WAV 기반 목소리 복제
```
Qwen3Loader → Qwen3VoiceClone
  text: "어머, 이렇게 오실 줄 몰랐어요."
  reference_audio: voices/chara_female.wav
```

**VoiceDesign**: 텍스트 설명으로 목소리 생성 (레퍼런스 없을 때)
```
Qwen3Loader → Qwen3VoiceDesign
  text: "안녕하세요."
  voice_description: "젊은 한국 여성, 부드럽고 약간 수줍은 목소리, 따뜻한 톤"
```

**CustomVoice**: 파인튜닝된 캐릭터 전용 목소리
```
Qwen3Loader (CustomVoice 모델) → Qwen3CustomVoice
  text: "오늘 어떠셨어요?"
  voice_id: "chara_main"
```

### 추천 상황
- 내레이션, 일상 대화
- 레퍼런스 음성이 있는 경우 기본 선택
- 새 캐릭터 목소리를 텍스트로 설계할 때

---

## Fish Audio S2 Pro

### 모드

**VoiceClone**:
```
FishS2VoiceCloneTTS
  text: "저...저는 그런 게 아니에요! [breath] 정말이에요."
  reference_audio: voices/chara_female.wav
```

**MultiSpeaker**: 2인 대화 장면
```
FishS2MultiSpeakerTTS
  speaker_1_ref: voices/chara_female.wav
  speaker_2_ref: voices/chara_male.wav
  script:
    "[SPK1] 오늘 어떠셨어요?"
    "[SPK2] 덕분에 좋았어요."
    "[SPK1] 그랬군요... [pause:0.5] 저도요."
```

**MultiSpeakerSplit**: 화자별 오디오 분리 출력
```
FishS2MultiSpeakerSplitTTS
  → output_1: SPK1 오디오만
  → output_2: SPK2 오디오만
  (각각 별도 S2V에 연결 가능)
```

### 감정 태그 전체 목록

```
[breath]         숨소리
[laugh]          웃음
[whisper]...[/whisper]  속삭임
[pause:0.5]      N초 간격
[sigh]           한숨
[cry]            울음
```

### 추천 상황
- 감정 강도 높은 대사 (당황, 부끄러움, 흥분)
- 2인 이상 대화 장면
- 숨소리·간격이 중요한 장면

---

## 혼용 전략

```json
[
  {
    "id": 1, "type": "lipsync",
    "dialogue": "어서 오세요. 잘 오셨어요.",
    "tts_engine": "qwen3",
    "tts_mode": "voice_clone",
    "tts_voice_ref": "voices/chara_female.wav"
  },
  {
    "id": 2, "type": "lipsync",
    "dialogue": "저...저는 그런 게 아니에요! [breath] 정말이에요.",
    "tts_engine": "s2pro",
    "tts_mode": "voice_clone",
    "tts_voice_ref": "voices/chara_female.wav"
  },
  {
    "id": 3, "type": "lipsync",
    "dialogue": "[SPK1] 이게 무슨... [SPK2] 그러니까요.",
    "tts_engine": "s2pro",
    "tts_mode": "multispeaker",
    "speaker_refs": ["voices/chara_female.wav", "voices/chara_male.wav"]
  }
]
```

---

## 레퍼런스 음성 파일 관리

```
voices/
  chara_main_female.wav     주인공 (3~10초, 깨끗한 음질)
  chara_neighbor_male.wav   상대 캐릭터
  narrator.wav              내레이션
```

레퍼런스 품질 기준:
- 길이: 3~10초
- 잡음: 없어야 함
- 감정: 중립적인 톤 (클론 후 감정 태그로 제어)
