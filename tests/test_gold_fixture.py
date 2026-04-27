import unittest

from backend.services.gold_fixture import derive_render_spec


class GoldFixtureTests(unittest.TestCase):
    def test_derive_render_spec_aligns_to_wan_safe_dimensions(self):
        profile = {
            "quality_contract": {
                "target_aspect_ratio": 1.86047,
                "target_fps": 29.966,
                "target_pix_fmt": "yuv420p",
                "target_audio_sample_rate": 48000,
                "target_audio_channels": 2,
                "target_lufs": -30.8,
                "target_shot_median_sec": 7.333,
                "target_shot_count_per_min": 9.1,
            }
        }

        spec = derive_render_spec(profile)

        self.assertEqual(spec["video"]["width"], 832)
        self.assertEqual(spec["video"]["height"], 448)
        self.assertEqual(spec["video"]["fps"], 29.966)
        self.assertEqual(spec["audio"]["sample_rate"], 48000)
        self.assertEqual(spec["editing"]["recommended_scene_count_for_70s"], 10)


if __name__ == "__main__":
    unittest.main()
