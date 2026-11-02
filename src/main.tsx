import React from "react";
import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import App from "./App";
import "./index.css";
import { applyTheme, setPriorityLook, storedPriorityLook, storedTheme } from "./lib/useTheme";

// Before the first paint, so the page never flashes the other theme
applyTheme(storedTheme());
setPriorityLook(storedPriorityLook());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
