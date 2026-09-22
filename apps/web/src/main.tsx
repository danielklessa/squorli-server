import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DialogHost } from "./dialogs";
import "./emoji/font.css";
import "./styles.css";
import { applyLocaleToDocument, locale } from "./i18n";
import { platform } from "./platform";

applyLocaleToDocument();
// The desktop shell draws a few things itself (the window's context menu, the tray's menu) and follows the client's language.
platform.setLanguage?.(locale);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <DialogHost />
  </React.StrictMode>,
);
