import { useEffect, useState } from "react";
import { Detector } from "./components/Detector";
import { ImageForensics } from "./components/ImageForensics";
import { VideoForensics } from "./components/VideoForensics";
import { Choice } from "./components/ui";
import { REPO_URL } from "./lib/links";

const TABS = [
  { value: "detect", label: "Image detection" },
  { value: "text", label: "Text detection" },
  { value: "image", label: "Image forensics" },
  { value: "video", label: "Video forensics" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export default function App() {
  const [tab, setTab] = useState<Tab>(() => TABS.find((t) => `#${t.value}` === window.location.hash)?.value ?? "detect");
  const [image, setImage] = useState<File | null>(null); // shared by Image detection and Image forensics
  const [text, setText] = useState("");
  const [video, setVideo] = useState<File | null>(null);

  useEffect(() => {
    window.history.replaceState(null, "", tab === "detect" ? window.location.pathname : `#${tab}`);
  }, [tab]);

  // Paste anywhere: images go to Image detection / Image forensics, videos to Video forensics, and on the Text
  // detection tab, text goes to the text box (a paste inside a text field is left to the field).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = e.clipboardData?.files[0];
      if (file?.type.startsWith("video/")) {
        setVideo(file);
        setTab("video");
      } else if (file?.type.startsWith("image/")) {
        setImage(file);
        if (tab === "video") setTab("image");
        else if (tab === "text") setTab("detect");
      } else if (tab === "text" && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) {
        const pasted = e.clipboardData?.getData("text/plain");
        if (pasted) setText(pasted);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [tab]);

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">AI Detection &amp; Forensics Lab</h1>
            <p className="mt-1 text-sm text-muted">Detect AI-generated content and inspect images and videos.</p>
          </div>
          {REPO_URL && (
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm transition hover:border-accent/60"
            >
              Source code<span className="hidden sm:inline">&nbsp;on GitHub</span>
            </a>
          )}
        </div>
        <aside className="flex gap-2.5 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5 text-sm">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 h-4 w-4 shrink-0 text-accent"
          >
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          <p>
            <strong className="font-semibold">Everything runs on your device.</strong> The models run in your browser,
            on your phone or computer, so your images, videos and texts are never uploaded. They also have to fit in your
            device's memory (RAM) and run on its processor: that is why they are small, megabytes where server-side AI
            models weigh gigabytes.
          </p>
        </aside>
        <Choice options={TABS} value={tab} onChange={setTab} />
      </header>

      <main>
        {tab === "detect" && <Detector task="image" image={image} onImage={setImage} />}
        {tab === "text" && <Detector task="text" text={text} onText={setText} />}
        {tab === "image" && <ImageForensics image={image} onImage={setImage} />}
        {tab === "video" && <VideoForensics file={video} onFile={setVideo} />}
      </main>

      <footer className="mt-auto flex flex-col gap-2 text-xs text-muted">
        <p>
          This site is a demo. Scores are probabilities and forensic views are indicators, not proof. Every detector makes
          mistakes, especially on content unlike its training data.
        </p>
        <nav className="[&_a:hover]:text-fg [&_a]:underline">
          <a href="/legal">Mentions légales</a> · <a href="/legal-en">Legal notice</a>
        </nav>
      </footer>
    </div>
  );
}
