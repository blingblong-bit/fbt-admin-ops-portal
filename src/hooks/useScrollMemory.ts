import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";

// Remembers the scroll position of every screen and restores it when you come
// back. Lists load asynchronously, so restoring keeps retrying until the page
// is tall enough (up to ~4s) or the user scrolls themselves.
export function useScrollMemory() {
  const location = useLocation();
  const key = `scroll:${location.pathname}${location.searchStr ?? ""}`;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = Number(window.sessionStorage.getItem(key) ?? "");
    let cancelled = false;
    let timer: number | undefined;
    const stop = () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
    if (saved > 0) {
      const started = Date.now();
      const tryRestore = () => {
        if (cancelled) return;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (max >= saved - 5) {
          window.scrollTo(0, saved);
          return;
        }
        if (Date.now() - started > 4000) {
          window.scrollTo(0, Math.max(0, max));
          return;
        }
        timer = window.setTimeout(tryRestore, 100);
      };
      tryRestore();
      window.addEventListener("wheel", stop, { once: true, passive: true });
      window.addEventListener("touchstart", stop, { once: true, passive: true });
    } else {
      window.scrollTo(0, 0);
    }
    const onScroll = () => {
      window.sessionStorage.setItem(key, String(Math.round(window.scrollY)));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      stop();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
    };
  }, [key]);
}
