"""Small compatibility nodes for legacy reference workflows."""


class TextConcatenateCompat:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "delimiter": ("STRING", {"default": ""}),
                "clean_whitespace": (["true", "false"], {}),
            },
            "optional": {
                "text_a": ("STRING", {"forceInput": True}),
                "text_b": ("STRING", {"forceInput": True}),
                "text_c": ("STRING", {"forceInput": True}),
                "text_d": ("STRING", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING",)
    FUNCTION = "concat"
    CATEGORY = "myaniform/compat"

    def concat(self, delimiter, clean_whitespace, **kwargs):
        if delimiter == "\\n":
            delimiter = "\n"
        parts = []
        for key in ("text_a", "text_b", "text_c", "text_d"):
            value = kwargs.get(key)
            if not isinstance(value, str):
                continue
            if clean_whitespace == "true":
                value = value.strip()
            if value:
                parts.append(value)
        return (delimiter.join(parts),)


class TextFindAndReplaceCompat:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"forceInput": True}),
                "find": ("STRING", {"default": ""}),
                "replace": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("STRING",)
    FUNCTION = "replace_text"
    CATEGORY = "myaniform/compat"

    def replace_text(self, text, find, replace):
        return ((text or "").replace(find or "", replace or ""),)


NODE_CLASS_MAPPINGS = {"Text Concatenate": TextConcatenateCompat}
NODE_CLASS_MAPPINGS["Text Find and Replace"] = TextFindAndReplaceCompat

NODE_DISPLAY_NAME_MAPPINGS = {
    "Text Concatenate": "Text Concatenate",
    "Text Find and Replace": "Text Find and Replace",
}
