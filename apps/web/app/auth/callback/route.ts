import { NextResponse, type NextRequest } from 'next/server';
import { createUserClient } from '@/lib/supabase/server';

// Email confirmation link lands here with a one-time code.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/calendar';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/calendar';

  if (code) {
    const supabase = await createUserClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${safeNext}`);
  }
  return NextResponse.redirect(`${origin}/login`);
}
