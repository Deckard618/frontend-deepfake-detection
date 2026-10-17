import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@site/index.css";
import { Panel } from "./Panel";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Panel />
  </StrictMode>,
);
