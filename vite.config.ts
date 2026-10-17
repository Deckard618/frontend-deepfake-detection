import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// Cross-origin isolation enables SharedArrayBuffer, which ONNX Runtime needs to run
// inference on several threads. Production sets the same headers (see nginx.conf).
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react()],
  server: { host: "::", port: 8080, headers: isolationHeaders },
  preview: { port: 8080, headers: isolationHeaders },
});
