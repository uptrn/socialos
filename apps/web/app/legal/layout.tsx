import { PublicShell } from '@/components/public-shell';
import { legalConfigured } from '@/lib/legal';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PublicShell>
      <article className="legal mx-auto max-w-3xl px-4 py-12 sm:px-6">
        {!legalConfigured() && (
          <p className="mb-6 rounded-lg bg-warning/10 px-4 py-3 text-sm text-warning">
            Draft: company details are not filled in yet (LEGAL_* settings). Have this text reviewed by a lawyer before publishing.
          </p>
        )}
        {children}
      </article>
    </PublicShell>
  );
}
