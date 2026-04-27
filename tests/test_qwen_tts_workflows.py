import json
import tempfile
import unittest
from pathlib import Path

from backend.services.workflow_patcher import patch_voice, patch_voice_design


ROOT = Path(__file__).resolve().parents[1]


class QwenTtsWorkflowTests(unittest.TestCase):
    def _load(self, name: str) -> dict:
        return json.loads((ROOT / "workflows" / name).read_text(encoding="utf-8"))

    def test_runtime_workflows_use_hobi_qwen_nodes_only(self):
        workflows = {
            "ws_tts_clone.json": {
                "Qwen3Loader",
                "Qwen3ClonePromptFromAudio",
                "Qwen3CustomVoiceFromPrompt",
                "SaveAudio",
            },
            "ws_voice_design.json": {
                "Qwen3Loader",
                "Qwen3DirectedCloneFromVoiceDesign",
                "SaveAudio",
            },
        }
        for filename, expected in workflows.items():
            with self.subTest(filename=filename):
                classes = {node["class_type"] for node in self._load(filename).values()}
                self.assertTrue(expected.issubset(classes))
                self.assertFalse(any(cls.startswith("FL_Qwen3TTS") for cls in classes))

    def test_patch_voice_clone_updates_hobi_custom_voice_node(self):
        with tempfile.TemporaryDirectory() as tmp:
            sample = Path(tmp) / "qwen_reference.wav"
            sample.write_bytes(b"placeholder")
            workflow = patch_voice(
                "새 대사입니다.",
                str(sample),
                "qwen3",
                output_prefix="test/qwen_clone",
            )
        custom_nodes = [
            node for node in workflow.values()
            if node.get("class_type") == "Qwen3CustomVoiceFromPrompt"
        ]
        self.assertEqual(custom_nodes[0]["inputs"]["text"], "새 대사입니다.")
        self.assertEqual(custom_nodes[0]["inputs"]["prompt"], ["3", 0])

    def test_patch_voice_design_updates_directed_clone_node(self):
        workflow = patch_voice_design(
            "따뜻하고 낮은 한국어 여성 목소리",
            sample_text="테스트 문장입니다.",
            language="Korean",
            params={"temperature": 1.1, "top_p": 0.95, "seed": 1234},
            output_prefix="test/qwen_design",
        )
        design_nodes = [
            node for node in workflow.values()
            if node.get("class_type") == "Qwen3DirectedCloneFromVoiceDesign"
        ]
        inputs = design_nodes[0]["inputs"]
        self.assertEqual(inputs["design_instruct"], "따뜻하고 낮은 한국어 여성 목소리")
        self.assertEqual(inputs["design_text"], "테스트 문장입니다.")
        self.assertEqual(inputs["target_text"], "테스트 문장입니다.")
        self.assertEqual(inputs["temperature"], 1.1)
        self.assertEqual(inputs["top_p"], 0.95)
        self.assertEqual(inputs["seed"], 1234)


if __name__ == "__main__":
    unittest.main()
