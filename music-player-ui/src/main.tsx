import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AudioSettingsProvider } from "./components/player/AudioSettingsContext";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AudioSettingsProvider><App /></AudioSettingsProvider>
  </React.StrictMode>,
);
