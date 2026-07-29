import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Landing from "./Landing";
import "./index.css";

/**
 * Hash routing, no dependency.
 *
 * Hash is used rather than the History API on purpose: it needs no server
 * rewrite rules, so `vite preview`, nginx serving a static dist/, and GitHub
 * Pages all work identically.
 *
 * "#/app" is the dashboard; anything else is the landing page.
 */

/** Route hashes own the whole view; everything else is an in-page anchor. */
function isRouteHash(hash: string): boolean {
  return hash === "" || hash === "#" || hash.startsWith("#/");
}

function Root() {
  const [route, setRoute] = useState(() => window.location.hash);

  useEffect(() => {
    const onHash = () => {
      const next = window.location.hash;
      setRoute(next);

      /**
       * Reset scroll only when the ROUTE changed.
       *
       * The landing page's "What it records" / "How it works" links are plain
       * `href="#features"`-style anchors, which also fire `hashchange`.
       * Scrolling to the top unconditionally cancelled the browser's native
       * jump, so the first click appeared to do nothing and only a second click
       * worked — by then the hash already matched, no `hashchange` fired, and
       * nothing undid the jump.
       */
      if (isRouteHash(next)) window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const isApp = route.startsWith("#/app");

  // The dashboard is a fixed-height flex shell; the landing page scrolls. The
  // `height: 100%` in index.css suits the former and would trap the latter, so
  // toggle it on the html/body/#root chain per route.
  useEffect(() => {
    document.documentElement.classList.toggle("route-scroll", !isApp);
  }, [isApp]);

  return isApp ? <App /> : <Landing />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
