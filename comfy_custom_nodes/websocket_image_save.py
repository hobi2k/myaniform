from PIL import Image
import numpy as np
import comfy.utils
import time


class SaveImageWebsocket:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",)}}

    RETURN_TYPES = ()
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "api/image"

    def save_images(self, images):
        pbar = comfy.utils.ProgressBar(images.shape[0])
        for step, image in enumerate(images):
            i = 255.0 * image.cpu().numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
            pbar.update_absolute(step, images.shape[0], ("PNG", img, None))
        return {}

    @classmethod
    def IS_CHANGED(cls, images):
        return time.time()


NODE_CLASS_MAPPINGS = {"SaveImageWebsocket": SaveImageWebsocket}
