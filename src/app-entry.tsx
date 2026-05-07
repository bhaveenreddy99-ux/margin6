import { createRoot } from "react-dom/client";
import App from "./App";
import { RootErrorBoundary } from "./RootErrorBoundary";
import "./index.css";

export function mountApp(rootEl: HTMLElement) {
  createRoot(rootEl).render(
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>,
  );
}
