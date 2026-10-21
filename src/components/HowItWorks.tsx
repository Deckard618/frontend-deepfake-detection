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

// The "How it works" animation (made by scripts/how-it-works/render.sh), in the page's color scheme. It plays by
// itself, muted and looping, unless the visitor asked for reduced motion: then it waits for the play button.
export function HowItWorks() {
  const theme = useMediaQuery("(prefers-color-scheme: dark)") ? "dark" : "light";
  const still = useMediaQuery("(prefers-reduced-motion: reduce)");
  return (
    <section className="flex flex-col gap-3">
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
        className="aspect-video w-full max-w-3xl rounded-lg border border-border bg-card"
      />
    </section>
  );
}
