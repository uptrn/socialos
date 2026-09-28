function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy apps/web/.env.example to apps/web/.env.local and fill it in.`);
  }
  return value;
}

// NEXT_PUBLIC_* must be referenced literally so Next.js can inline them in the browser bundle.
export const publicEnv = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseKey: () => required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
};

export const serverEnv = {
  supabaseSecretKey: () => required('SUPABASE_SECRET_KEY', process.env.SUPABASE_SECRET_KEY),
  cronSecret: () => required('CRON_SECRET', process.env.CRON_SECRET),
  mockAccountsEnabled: () => process.env.ENABLE_MOCK_ACCOUNTS === 'true',
};
