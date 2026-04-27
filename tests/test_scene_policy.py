import unittest

from backend.services.scene_policy import compose_scene_image_prompts


class ScenePolicyTests(unittest.TestCase):
    def test_scene_prompt_does_not_force_outfit_or_pose_when_empty(self):
        positive, negative = compose_scene_image_prompts("spring night street", {})

        self.assertEqual(positive, "spring night street")
        self.assertIsNone(negative)

    def test_scene_prompt_uses_only_user_supplied_direction_fields(self):
        positive, negative = compose_scene_image_prompts(
            "spring night street",
            {
                "outfit_prompt": "black dress",
                "pose_prompt": "standing three-quarter view",
                "composition_prompt": "full body shot",
                "camera_prompt": "low angle",
                "expression_prompt": "soft smile",
                "lighting_prompt": "warm rim light",
                "style_prompt": "cinematic anime still",
                "negative_prompt": "watermark, bad anatomy",
            },
        )

        self.assertEqual(
            positive,
            (
                "spring night street. black dress. standing three-quarter view. "
                "full body shot. low angle. soft smile. warm rim light. cinematic anime still"
            ),
        )
        self.assertEqual(negative, "watermark, bad anatomy")

    def test_wardrobe_prompt_remains_user_controlled_alias(self):
        positive, _ = compose_scene_image_prompts(
            "bedroom scene",
            {"wardrobe_prompt": "oversized white shirt"},
        )

        self.assertEqual(positive, "bedroom scene. oversized white shirt")


if __name__ == "__main__":
    unittest.main()
