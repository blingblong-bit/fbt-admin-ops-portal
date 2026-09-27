import { useEffect } from "react";
import { useLocation, useRouter } from "@tanstack/react-router";

// Remembers each screen's scroll position and restores it on return (Back).
// The position is captured the moment you navigate away, then saving is frozen
// so the briefly-empty page during the transition can't overwrite it with 0.
// Restoring waits for async lists to render (up to ~6s) and only gives up if
// the user actually scrolls (wheel / finger drag), not on a simple tap.
export function useScrollMemory() {
  const location = useLocation();
  const router = useRouter();
  const key = `scroll:${location.pathname}${location.searchStr ?? ""}`;

  useEffect(() => {
    if (typeof window === "undefined") return;
    let frozen = false;
    let cancelled = false;
    let timer: number | undefined;

    const save = () => {
      if (!frozen) window.sessionStorage.setItem(key, String(Math.round(window.scrollY)));
    };
    const cancelRestore = () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };

    const saved = Number(window.sessionStorage.getItem(key) ?? "");
    if (saved > 0) {
      // Don't let our own restore attempts save intermediate positions.
      frozen = true;
      const started = Date.now();
      const tryRestore = () => {
        if (cancelled) {
          frozen = false;
          return;
        }
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (max >= saved - 5 || Date.now() - started > 6000) {
          window.scrollTo(0, Math.min(saved, Math.max(0, max)));
          frozen = false;
          return;
        }
        timer = window.setTimeout(tryRestore, 100);
      };
      tryRestore();
    } else {
      window.scrollTo(0, 0);
    }

    const unsub = router.subscribe("onBeforeNavigate", () => {
      frozen = false;
      save();
      frozen = true;
      cancelRestore();
    });

    window.addEventListener("scroll", save, { passive: true });
    window.addEventListener("wheel", cancelRestore, { passive: true });
    window.addEventListener("touchmove", cancelRestore, { passive: true });
    return () => {
      // Capture on unmount too (e.g. phone back button), unless already frozen.
      save();
      frozen = true;
      cancelRestore();
      unsub();
      window.removeEventListener("scroll", save);
      window.removeEventListener("wheel", cancelRestore);
      window.removeEventListener("touchmove", cancelRestore);
    };
  }, [key, router]);
}
