import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  /** Human label for what failed, e.g. "Profit Risk". */
  label?: string;
  /** Optional refetch hook — invoked alongside resetting the boundary. */
  onRetry?: () => void;
  children: ReactNode;
};

type State = { error: Error | null };

/**
 * Card-scoped error boundary for the dashboard (silent-$0 trust fix).
 *
 * A KPI card that throws while rendering must NOT render outside the error
 * contract — it can't blank the whole dashboard, and it can't silently vanish
 * leaving a confident-looking layout. This catches the throw and renders the
 * same "couldn't calculate — tap to retry" state the loaders use for query
 * failures, so a render-time crash reads as an honest error, never as $0.
 */
export class DashboardErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[DashboardErrorBoundary]", this.props.label ?? "", error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 flex flex-col items-center justify-center gap-3 text-center min-h-[140px]">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-500">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {this.props.label ? `${this.props.label} couldn't load` : "Couldn't calculate"}
          </span>
          <p className="text-xs text-muted-foreground max-w-[220px]">
            This isn&apos;t $0 — the card hit an error while rendering.
          </p>
          <Button variant="outline" size="sm" onClick={this.handleRetry}>
            Retry
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
