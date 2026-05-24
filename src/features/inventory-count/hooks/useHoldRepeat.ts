import { useCallback, useRef } from "react";

/** Fire once immediately, then every `intervalMs` after `delayMs` while pointer is held. */
export function useHoldRepeat(onTick: () => void, delayMs = 500, intervalMs = 150) {
  const delayRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (delayRef.current != null) {
      window.clearTimeout(delayRef.current);
      delayRef.current = null;
    }
    if (intervalRef.current != null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    stop();
    onTick();
    delayRef.current = window.setTimeout(() => {
      intervalRef.current = window.setInterval(onTick, intervalMs);
    }, delayMs);
  }, [delayMs, intervalMs, onTick, stop]);

  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      start();
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
  };
}
