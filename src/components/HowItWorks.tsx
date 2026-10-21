import { useSyncExternalStore } from "react";

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

// The animation's labels are too small to read on a phone: the steps say the same in text.
const STEPS = [
  "Your browser downloads the AI model, once.",
  "Your device's processor analyzes your image or text.",
  "Nothing is uploaded: your files never leave your device.",
];

// The "How it works" animation (made by scripts/how-it-works/render.sh), in the page's color scheme. It plays by
// itself, muted and looping, unless the visitor asked for reduced motion: then it waits for the play button.
// The banner's "How it works" button scrolls here, to the id.
export function HowItWorks() {
  const theme = useMediaQuery("(prefers-color-scheme: dark)") ? "dark" : "light";
  const still = useMediaQuery("(prefers-reduced-motion: reduce)");
  return (
    <section id="how-it-works" tabIndex={-1} className="mx-auto flex w-full max-w-3xl flex-col gap-3 focus:outline-none">
      <h2 className="text-lg font-semibold">How it works</h2>
      <video
        key={theme}
        src={`/how-it-works/${theme}.mp4`}
        autoPlay={!still}
        controls={still}
        muted
        loop
        playsInline
        aria-label="A typical online detector uploads your image to its server, which runs the model. This site downloads the model once and runs it on your device's processor: your image stays on your device."
        className="aspect-video w-full rounded-lg border border-border bg-card"
      />
      <ol className="grid gap-2 text-sm sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step} className="flex gap-2.5 rounded-lg border border-border bg-card p-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted">
        The models have to fit in your device's memory (RAM) and run on its processor: that is why they are small,
        megabytes where server-side AI models weigh gigabytes.
      </p>
    </section>
  );
}
