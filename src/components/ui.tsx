import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card p-5 shadow-sm ${className}`}>{children}</div>;
}

export function Button({ primary, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  const look = primary
    ? "bg-accent font-medium text-white hover:opacity-90"
    : "border border-border hover:border-accent/60";
  return (
    <button
      type="button"
      className={`rounded-lg px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${look} ${className}`}
      {...props}
    />
  );
}

/** Mutually exclusive options: tabs, modes, presets. */
export function Choice<T extends string>({ options, value, onChange, disabled }: {
  options: readonly { value: T; label: string; hint?: string }[];
  value: T | null; // null: none picked yet
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.hint}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`rounded-md border px-3 py-1.5 text-sm transition disabled:opacity-40 ${
            o.value === value ? "border-accent bg-accent text-white" : "border-border hover:border-accent/60"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Click to choose, or drop a file. (Pasting is handled once, in App.) */
export function DropZone({ accept, onFile, onUrl, disabled, children }: {
  accept: "image" | "video";
  onFile: (file: File) => void;
  /** Gets the address of an image dragged from a web page, which comes without a file. */
  onUrl?: (url: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (disabled) return;
        const file = e.dataTransfer.files[0];
        if (file?.type.startsWith(`${accept}/`)) onFile(file);
        else if (!file && onUrl) {
          const url = droppedImageUrl(e.dataTransfer);
          if (url) onUrl(url);
        }
      }}
      className={`flex min-h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-center text-sm transition ${
        dragging ? "border-accent bg-accent/5" : "border-border hover:border-accent/60"
      }`}
    >
      <input
        type="file"
        accept={`${accept}/*`}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      {children}
    </label>
  );
}

function droppedImageUrl(data: DataTransfer): string | null {
  // The <img> first: for an image inside a link, the URL list holds the link's address.
  const html = data.getData("text/html");
  const img = html ? new DOMParser().parseFromString(html, "text/html").querySelector("img")?.getAttribute("src") : null;
  const url = img || data.getData("text/uri-list").split(/\r?\n/).find((line) => line && !line.startsWith("#"));
  return url && /^(https?|data):/i.test(url) ? url : null;
}

/** Collapsible explanation under a tool. */
export function Explain({ title = "How to read this", children }: { title?: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-border p-3 text-sm text-muted [&_b]:text-fg [&_h4]:mt-3 [&_h4]:font-semibold [&_h4]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-2">
      <summary className="cursor-pointer font-medium text-fg">{title}</summary>
      {children}
    </details>
  );
}
