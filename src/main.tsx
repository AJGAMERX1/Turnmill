import ReactDOM from "react-dom/client";
import App from "./App";
import "./style.css";
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const entry = document.querySelector<HTMLScriptElement>(
    'script[type="module"][src]',
  )?.src;
  const announce = () => {
    if (entry)
      navigator.serviceWorker.controller?.postMessage({
        type: "turnmill-entry",
        url: entry,
      });
  };
  navigator.serviceWorker.addEventListener("controllerchange", announce);
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "turnmill-request-entry") announce();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then(announce)
      .catch(() => {});
  });
}
