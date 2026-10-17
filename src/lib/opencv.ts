/**
 * OpenCV.js (11 MB) is only needed for the optical-flow view, so it is loaded on demand.
 * It is served from public/opencv (no third-party request), pinned and integrity-checked:
 * @techstark/opencv-js 4.11.0-release.1, dist/opencv.js.
 */
const SRC = `${import.meta.env.BASE_URL}opencv/opencv.js`;
const INTEGRITY = "sha384-oavEdO4ZHMHZLyB8LRX8Vmsn9BuESS2RmefVDvsZOcvAlEtuRiiUj4CZGMEL1fPU";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpenCV = any;

let loading: Promise<OpenCV> | undefined;

export function loadOpenCV(): Promise<OpenCV> {
  loading ??= loadFrom(SRC).catch(() => {
    loading = undefined;
    throw new Error("Could not load OpenCV.js, which the optical-flow view needs.");
  });
  return loading;
}

function loadFrom(src: string): Promise<OpenCV> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.integrity = INTEGRITY;
    script.onerror = () => {
      script.remove();
      reject(new Error(`Could not load ${src}`));
    };
    // This build sets window.cv to a Promise of the initialised module.
    script.onload = () => Promise.resolve((window as unknown as { cv: unknown }).cv).then(resolve, reject);
    document.head.appendChild(script);
  });
}
