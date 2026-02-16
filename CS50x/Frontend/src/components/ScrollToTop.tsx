// src/components/ScrollToTop.tsx
import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

export default function ScrollToTop() {
  const { pathname, search } = useLocation();

  useLayoutEffect(() => {
    try {
      // Prevent the browser from restoring the previous scroll position on navigation.
      if ("scrollRestoration" in window.history) {
        window.history.scrollRestoration = "manual";
      }

      const scrollNow = () => {
        // Cover more browsers / quirks
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        window.scrollTo(0, 0);
      };

      // Run immediately and again after next paint (handles late layout shifts).
      scrollNow();
      const raf = requestAnimationFrame(scrollNow);
      const t = window.setTimeout(scrollNow, 0);
      return () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(t);
      };
    } catch {
      return;
    }
  }, [pathname, search]);

  return null;
}
