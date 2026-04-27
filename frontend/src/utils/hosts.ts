export function serviceUrl(port: number) {
  if (typeof window === "undefined") {
    return `http://127.0.0.1:${port}`;
  }
  const host = window.location.hostname || "127.0.0.1";
  return `http://${host}:${port}`;
}

export const comfyUiUrl = () => serviceUrl(8188);
export const backendUrl = () => serviceUrl(8000);
