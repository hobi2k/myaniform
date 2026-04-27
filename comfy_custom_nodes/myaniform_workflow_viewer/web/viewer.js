// myaniform workflow viewer
//
// URL example: http://localhost:8188/?workflow=ws_loop
// - workflow=<name> loads /api/workflows/<name> from the myaniform backend.
// - parent frames can postMessage({ type: "myaniform:load", workflow: "ws_effect" }).

import { app } from "/scripts/app.js";

function backendUrl() {
  const host = window.location.hostname || "127.0.0.1";
  return `http://${host}:8000`;
}

async function fetchWorkflow(name) {
  const safe = String(name).replace(/[^a-zA-Z0-9_\-]/g, "");
  if (!safe) {
    throw new Error(`invalid workflow name: ${name}`);
  }
  const res = await fetch(`${backendUrl()}/api/workflows/${safe}`, {
    credentials: "omit",
  });
  if (!res.ok) {
    throw new Error(`workflow fetch failed: ${res.status}`);
  }
  return { data: await res.json(), name: safe };
}

async function loadWorkflowByName(name) {
  try {
    const { data, name: safe } = await fetchWorkflow(name);
    await app.loadApiJson(data, `${safe}.json`);
    console.log(`[myaniform] loaded workflow: ${safe}`);
    window.parent?.postMessage({ type: "myaniform:loaded", workflow: safe }, "*");
  } catch (e) {
    console.error("[myaniform] load failed:", e);
    window.parent?.postMessage(
      { type: "myaniform:error", message: e instanceof Error ? e.message : String(e) },
      "*",
    );
  }
}

app.registerExtension({
  name: "myaniform.WorkflowViewer",
  async setup() {
    const params = new URLSearchParams(window.location.search);
    const initial = params.get("workflow");
    if (initial) {
      setTimeout(() => loadWorkflowByName(initial), 200);
    }

    window.addEventListener("message", (ev) => {
      const msg = ev.data;
      if (msg && msg.type === "myaniform:load" && msg.workflow) {
        loadWorkflowByName(msg.workflow);
      }
    });

    try {
      window.parent?.postMessage({ type: "myaniform:ready" }, "*");
    } catch (_) {}
  },
});
