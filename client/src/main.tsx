import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Suppress harmless ResizeObserver errors
const originalError = console.error;
console.error = (...args) => {
  if (
    args[0] && 
    typeof args[0] === 'string' && 
    args[0].includes('ResizeObserver loop completed with undelivered notifications')
  ) {
    return;
  }
  originalError.apply(console, args);
};

window.addEventListener('error', (e) => {
  if (e.message === 'ResizeObserver loop completed with undelivered notifications.') {
    e.stopImmediatePropagation();
    e.stopPropagation();
    e.preventDefault();
  }
});

if (window.visualViewport) {
  let prevHeight = window.visualViewport.height;
  window.visualViewport.addEventListener('resize', () => {
    const nextHeight = window.visualViewport!.height;
    if (nextHeight > prevHeight) {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
    prevHeight = nextHeight;
  });
}

createRoot(document.getElementById("root")!).render(<App />);
