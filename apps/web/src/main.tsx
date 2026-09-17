import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DialogHost } from "./dialogs";
import "./emoji/font.css";
import "./styles.css";
import { applyLocaleToDocument } from "./i18n";

applyLocaleToDocument();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <DialogHost />
  </React.StrictMode>,
);
