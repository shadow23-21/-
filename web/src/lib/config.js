// Empty for the local gateway; set VITE_API_BASE for the Android WebView
// (e.g. http://127.0.0.1:8787 with `adb reverse tcp:8787 tcp:8787`).
export const API_BASE = import.meta.env.VITE_API_BASE || '';
