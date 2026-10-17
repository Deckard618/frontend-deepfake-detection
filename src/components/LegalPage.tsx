import type { ReactNode } from "react";

/** Layout shared by the legal pages (their texts live in src/pages). */
export function LegalPage({ title, updated, children }: { title: string; updated: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <a href="/" className="text-sm text-muted hover:text-fg">← Back</a>
      <article className="mt-4 flex flex-col gap-4 rounded-xl border border-border bg-card p-6 text-sm leading-relaxed text-muted shadow-sm [&_a]:text-accent [&_a]:underline [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-fg [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-medium [&_h3]:text-fg [&_p]:mt-2 [&_strong]:text-fg [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1">
        <header>
          <h1 className="text-2xl font-semibold text-fg">{title}</h1>
          <p className="mt-1 text-xs">{updated}</p>
        </header>
        {children}
      </article>
    </div>
  );
}
