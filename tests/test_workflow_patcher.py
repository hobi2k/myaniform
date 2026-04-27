import unittest

from backend.services.workflow_patcher import patch_video_lipsync


class WorkflowPatcherTests(unittest.TestCase):
    def test_fastfidelity_s2v_reuses_one_unet_for_two_stage_sampling(self):
        workflow = patch_video_lipsync(
            image_path="input_frame.png",
            voice_path="voice.flac",
            bg_prompt="soft visual novel room tone",
            sfx_prompt="quiet room tone",
            params={
                "width": 832,
                "height": 448,
                "frames": 81,
                "steps": 6,
                "reuse_s2v_model": True,
            },
            output_prefix="test/s2v",
        )

        unet_loaders = [
            node for node in workflow.values()
            if node.get("class_type") in {"UNETLoader", "UnetLoaderGGUF"}
        ]
        samplers = [
            node for node in workflow.values()
            if node.get("class_type") == "KSamplerAdvanced"
        ]

        self.assertEqual(len(unet_loaders), 1)
        self.assertEqual(len(samplers), 2)
        self.assertEqual(samplers[0]["inputs"]["model"], samplers[1]["inputs"]["model"])

    def test_s2v_prompt_requires_audio_driven_body_performance(self):
        workflow = patch_video_lipsync(
            image_path="input_frame.png",
            voice_path="voice.flac",
            bg_prompt="soft visual novel room tone",
            sfx_prompt="quiet room tone",
            params={
                "motion_prompt": "she turns her shoulders and reaches toward the door",
                "camera_motion_prompt": "slow push-in timed to the line ending",
            },
            output_prefix="test/s2v",
        )

        texts = [
            node.get("inputs", {}).get("text", "")
            for node in workflow.values()
            if node.get("class_type") == "CLIPTextEncode"
        ]
        joined = "\n".join(str(text) for text in texts)
        self.assertIn("Audio-driven character performance", joined)
        self.assertIn("shoulders", joined)
        self.assertIn("hand gestures", joined)
        self.assertIn("she turns her shoulders", joined)
        self.assertIn("only lips moving", joined)


if __name__ == "__main__":
    unittest.main()
