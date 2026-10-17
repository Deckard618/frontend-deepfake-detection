import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Legal notice, loaded on demand. Every other path shows the app.
// It covers privacy and terms too, so their older URLs lead to it.
const legalFR = lazy(() => import("./pages/LegalNotice"));
const legalEN = lazy(() => import("./pages/LegalNoticeEN"));
const PAGES: Record<string, typeof legalFR> = {
  "/legal": legalFR,
  "/privacy": legalFR,
  "/terms": legalFR,
  "/legal-en": legalEN,
  "/privacy-en": legalEN,
  "/privacy-policy": legalEN,
  "/terms-en": legalEN,
  "/terms-of-service": legalEN,
};
const Page = PAGES[window.location.pathname.replace(/\/+$/, "")];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {Page ? (
      <Suspense fallback={null}>
        <Page />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
