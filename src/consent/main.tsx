import React from "react";
import ReactDOM from "react-dom/client";
import "../index.css";
import { ConsentPage } from "./ConsentPage";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConsentPage />
  </React.StrictMode>,
);
