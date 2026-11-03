import React from "react";
import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import App from "./App";
import "./index.css";
import { applyTheme, storedTheme } from "./lib/useTheme";

// Before the first paint, so the page never flashes the other theme
applyTheme(storedTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
