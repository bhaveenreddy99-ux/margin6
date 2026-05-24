import * as React from "react";

const PHONE_BREAKPOINT = 640;
const TABLET_MAX_BREAKPOINT = 1024;

/** Phone speed-count UI: viewport width under 640px. */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${PHONE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < PHONE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < PHONE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

/** Tablet list UI: 640px–1023px. */
export function useIsTablet() {
  const [isTablet, setIsTablet] = React.useState(false);

  React.useEffect(() => {
    const onChange = () => {
      const w = window.innerWidth;
      setIsTablet(w >= PHONE_BREAKPOINT && w < TABLET_MAX_BREAKPOINT);
    };
    const mql = window.matchMedia(`(max-width: ${TABLET_MAX_BREAKPOINT - 1}px)`);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isTablet;
}

export function useIsCompact() {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  return isMobile || isTablet;
}
