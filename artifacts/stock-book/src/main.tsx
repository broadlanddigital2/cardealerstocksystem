import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";

// NOTE: The primary guard against benign dev-overlay "phantom crashes" lives in
// index.html as a classic inline script. That script runs during HTML parsing —
// before Vite's deferred module scripts (the dev client + runtime-error overlay
// plugin) register their listeners — so it can stopImmediatePropagation() on
// benign non-Error events before the overlay ever sees them, and it wraps
// ResizeObserver at the source. The listeners below are a redundant safety net
// (e.g. if that inline script ever fails to run); they only neutralise
// non-Error events, so genuine Error rejections/throws still propagate.

// Some third-party libraries (e.g. the Clerk SDK and the Uppy uploader) reject
// internal promises with non-Error values (plain strings/objects). In the dev
// preview these bubble up as an opaque "uncaught exception ... not an error
// object" overlay even though they do not affect the running app. Genuine
// application errors are always thrown as Error instances (the API client
// throws ApiError), so we only neutralise non-Error rejections here — logging
// them for visibility — and let real Error rejections propagate normally.
//
// We register in the CAPTURE phase and call stopImmediatePropagation() so the
// dev runtime-error overlay's own listener never sees the benign event.
// preventDefault() alone stops the browser default but NOT other listeners,
// so the overlay would still report a phantom "crash".
window.addEventListener(
  "unhandledrejection",
  (event) => {
    if (!(event.reason instanceof Error)) {
      console.warn("Ignoring non-Error promise rejection:", event.reason);
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  },
  true,
);

// The same applies to uncaught window "error" events that carry no real Error
// object (event.error is null) — e.g. benign "ResizeObserver loop" notifications
// fired by Radix UI dropdowns/dialogs, or cross-origin "Script error." entries.
// These do not affect the running app but otherwise surface as the opaque
// "uncaught exception ... not an error object" overlay in the dev preview.
// Genuine render/runtime errors are thrown as Error instances (caught by the
// ErrorBoundary), so we only neutralise non-Error events and let real ones pass.
window.addEventListener(
  "error",
  (event) => {
    if (!(event.error instanceof Error)) {
      console.warn("Ignoring non-Error window error:", event.message);
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  },
  true,
);

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
