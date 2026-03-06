import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// PWA registration temporarily disabled for development
// In production build, PWA will work automatically
// import { registerSW } from "virtual:pwa-register";
// registerSW({
//   immediate: true
// });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
