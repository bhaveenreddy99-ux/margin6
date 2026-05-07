import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };

/**
 * Catches React render errors so a failed tree does not leave a totally blank page.
 */
export class RootErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[RootErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const e = this.state.error;
      return (
        <div
          style={{
            minHeight: "100vh",
            padding: 24,
            fontFamily: "system-ui, sans-serif",
            background: "#fef2f2",
            color: "#450a0a",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ marginBottom: 12, color: "#7f1d1d" }}>
            The app hit an error while rendering. Open the browser console (⌥⌘J / F12) for full details.
          </p>
          <pre
            style={{
              fontSize: 12,
              overflow: "auto",
              padding: 12,
              background: "white",
              border: "1px solid #fecaca",
              borderRadius: 8,
            }}
          >
            {e.message}
            {e.stack ? `\n\n${e.stack}` : ""}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
