import { useState } from "react";

// The "How it works" animation (made by scripts/how-it-works/render.sh), in the page's color scheme. Nothing is
// downloaded until it is opened, and closing it removes the video.
export function HowItWorks() {
  const [open, setOpen] = useState(false);
  const theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return (
    <details className="mt-1.5" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="w-fit cursor-pointer select-none font-medium text-accent hover:underline">How it works</summary>
      {open && (
        <video
          key={theme}
          src={`/how-it-works/${theme}.mp4`}
          autoPlay
          muted
          loop
          playsInline
          aria-label="A typical online detector uploads your image to its server, which runs the model. This site downloads the model once and runs it on your device's processor: your image stays on your device."
          className="mt-2 aspect-video w-full max-w-3xl rounded-lg border border-border bg-card"
        />
      )}
    </details>
  );
}
