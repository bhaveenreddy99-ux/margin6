const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing <div id=\"root\"></div> in index.html");
}

function showBootstrapFailure(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack : "";
  rootEl.replaceChildren();
  const wrap = document.createElement("div");
  wrap.setAttribute(
    "style",
    "font-family: system-ui, sans-serif; padding: 24px; max-width: 42rem; margin: 0 auto; color: #0f172a;",
  );
  wrap.innerHTML = `
    <h1 style="font-size: 1.125rem; font-weight: 600; margin: 0 0 8px;">App failed to start</h1>
    <p style="margin: 0 0 12px; line-height: 1.5; color: #334155;">
      A module did not load or threw while initializing. This often means a network error loading JS,
      a misconfigured <code>base</code> URL for assets, or a code error. Check the browser console
      and restart the dev server (<code>npm run dev</code>).
    </p>
    <pre style="font-size: 12px; overflow: auto; padding: 12px; background: #f1f5f9; border-radius: 8px; white-space: pre-wrap; word-break: break-word;">${escapeHtml(
      msg + (stack ? "\n\n" + stack : ""),
    )}</pre>
  `;
  rootEl.appendChild(wrap);
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Dynamic import so any failure in the app module graph is a rejected promise (caught below).
// Synchronous `import App` in main would leave the static HTML in #root with no user-visible error.
import("./app-entry")
  .then((mod) => {
    rootEl.replaceChildren();
    mod.mountApp(rootEl);
  })
  .catch((err) => {
    console.error("[Margin6] Bootstrap failed:", err);
    showBootstrapFailure(err);
  });
