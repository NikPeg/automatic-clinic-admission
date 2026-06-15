import { Experience } from "@/components/Experience.tsx";

export default function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-6 sm:px-8 sm:py-8">
      <header className="mb-10 flex items-center justify-between sm:mb-14">
        <div className="flex items-center gap-2 text-[var(--color-ink)]">
          <svg viewBox="0 0 24 24" className="size-5 text-[var(--color-accent)]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h3l2 5 4-12 2 7h7" />
          </svg>
          <span className="text-sm font-semibold tracking-tight">Clinic Intake</span>
        </div>
        <span className="text-xs text-[var(--color-muted)]">Voice booking · live demo</span>
      </header>

      <Experience />
    </main>
  );
}
