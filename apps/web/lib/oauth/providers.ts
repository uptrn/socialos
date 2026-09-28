import 'server-only';
import type { Platform } from '@socialos/core';

export type ProviderId = 'meta' | 'linkedin' | 'x' | 'youtube' | 'tiktok' | 'threads';

/** Credentials stored (encrypted) for one connected account. */
export interface StoredCredentials {
  access_token: string;
  refresh_token?: string;
  refresh_expires_at?: string;
  /** When access_token expires (ISO). Absent = does not expire. */
  expires_at?: string;
}

export interface RefreshedCredentials {
  credentials: StoredCredentials;
  expiresAt?: string;
}

/** An account the user can choose to connect after signing in to a provider. */
export interface Candidate {
  platform: Platform;
  externalId: string;
  name: string;
  avatarUrl?: string;
  credentials: StoredCredentials;
  expiresAt?: string;
  scopes: string[];
}

export interface OAuthProvider {
  id: ProviderId;
  label: string;
  platforms: Platform[];
  configured(): boolean;
  /** Uses PKCE (S256); the start route then passes a code challenge / verifier. */
  pkce?: boolean;
  authorizeUrl(state: string, redirectUri: string, codeChallenge?: string): string;
  /** Exchange the code and list every account this login can publish to. */
  connect(code: string, redirectUri: string, codeVerifier?: string): Promise<Candidate[]>;
  /** Get a fresh access token. Absent when tokens can't be refreshed programmatically. */
  refresh?(credentials: StoredCredentials): Promise<RefreshedCredentials>;
}

export class ProviderError extends Error {}

const inSeconds = (sec: number | undefined) => (sec ? new Date(Date.now() + sec * 1000).toISOString() : undefined);
const form = (params: Record<string, string>) => new URLSearchParams(params);

async function json<T>(res: Response, what: string): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message ?? body?.message ?? body?.error_description ?? res.statusText;
    throw new ProviderError(`${what} failed (${res.status}): ${message}`);
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// Meta: Facebook Pages + Instagram business accounts linked to those Pages
// Docs: developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
//       developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
// ---------------------------------------------------------------------------

export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v25.0';
const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
  // Analytics
  'read_insights',
  'instagram_manage_insights',
  // Inbox: read, reply to and hide comments
  'pages_read_user_content',
  'pages_manage_engagement',
  'instagram_manage_comments',
];

const meta: OAuthProvider = {
  id: 'meta',
  label: 'Facebook & Instagram',
  platforms: ['facebook', 'instagram'],
  configured: () => !!(process.env.META_APP_ID && process.env.META_APP_SECRET),

  authorizeUrl(state, redirectUri) {
    const url = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
    url.search = new URLSearchParams({
      client_id: process.env.META_APP_ID!,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: META_SCOPES.join(','),
    }).toString();
    return url.toString();
  },

  async connect(code, redirectUri) {
    const graph = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
    const appId = process.env.META_APP_ID!;
    const secret = process.env.META_APP_SECRET!;

    const short = await json<{ access_token: string }>(
      await fetch(`${graph}/oauth/access_token?${new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, client_secret: secret, code })}`),
      'Meta code exchange',
    );
    // Long-lived user token (~60 days); Page tokens fetched with it do not expire.
    const long = await json<{ access_token: string }>(
      await fetch(`${graph}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: secret, fb_exchange_token: short.access_token })}`),
      'Meta long-lived token exchange',
    );

    const pages = await json<{
      data: {
        id: string;
        name: string;
        access_token: string;
        picture?: { data?: { url?: string } };
        instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
      }[];
    }>(
      await fetch(`${graph}/me/accounts?${new URLSearchParams({
        fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}',
        limit: '100',
        access_token: long.access_token,
      })}`),
      'Meta page list',
    );

    const candidates: Candidate[] = [];
    for (const page of pages.data) {
      candidates.push({
        platform: 'facebook',
        externalId: page.id,
        name: page.name,
        avatarUrl: page.picture?.data?.url,
        credentials: { access_token: page.access_token },
        scopes: META_SCOPES,
      });
      const ig = page.instagram_business_account;
      if (ig) {
        candidates.push({
          platform: 'instagram',
          externalId: ig.id,
          name: ig.username ? `@${ig.username}` : `${page.name} (Instagram)`,
          avatarUrl: ig.profile_picture_url,
          // Instagram publishing via Facebook Login uses the linked Page's token.
          credentials: { access_token: page.access_token },
          scopes: META_SCOPES,
        });
      }
    }
    return candidates;
  },
};

// ---------------------------------------------------------------------------
// LinkedIn: company pages the member administers
// Docs: learn.microsoft.com/linkedin/shared/authentication/authorization-code-flow
//       learn.microsoft.com/linkedin/marketing/community-management/organizations/organization-access-control-by-role
// ---------------------------------------------------------------------------

export const LINKEDIN_API_VERSION = process.env.LINKEDIN_API_VERSION ?? '202609';
// For Inbox comments, LinkedIn documents r_organization_social_feed / w_organization_social_feed. Add them
// through LINKEDIN_SCOPES once your app has been granted them (requesting an ungranted scope fails sign-in).
const LINKEDIN_SCOPES = (process.env.LINKEDIN_SCOPES ?? 'w_organization_social r_organization_social rw_organization_admin').split(' ');
const LINKEDIN_POSTING_ROLES = ['ADMINISTRATOR', 'CONTENT_ADMINISTRATOR', 'DIRECT_SPONSORED_CONTENT_POSTER'];

export function linkedinHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Linkedin-Version': LINKEDIN_API_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

const linkedin: OAuthProvider = {
  id: 'linkedin',
  label: 'LinkedIn Pages',
  platforms: ['linkedin'],
  configured: () => !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),

  authorizeUrl(state, redirectUri) {
    const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      redirect_uri: redirectUri,
      state,
      scope: LINKEDIN_SCOPES.join(' '),
    }).toString();
    return url.toString();
  },

  async connect(code, redirectUri) {
    const token = await json<{ access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number }>(
      await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: process.env.LINKEDIN_CLIENT_ID!,
          client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
          redirect_uri: redirectUri,
        }),
      }),
      'LinkedIn code exchange',
    );
    const now = Date.now();
    const expiresAt = new Date(now + token.expires_in * 1000).toISOString();
    const credentials: StoredCredentials = {
      access_token: token.access_token,
      expires_at: expiresAt,
      refresh_token: token.refresh_token,
      refresh_expires_at: token.refresh_token_expires_in ? new Date(now + token.refresh_token_expires_in * 1000).toISOString() : undefined,
    };

    const acls = await json<{ elements: { role: string; state: string; organization?: string; organizationTarget?: string }[] }>(
      await fetch(`https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&state=APPROVED&count=100`, { headers: linkedinHeaders(token.access_token) }),
      'LinkedIn page list',
    );
    const orgUrns = [...new Set(
      acls.elements
        .filter((e) => LINKEDIN_POSTING_ROLES.includes(e.role))
        .map((e) => e.organization ?? e.organizationTarget)
        .filter((urn): urn is string => !!urn?.startsWith('urn:li:organization:')),
    )];

    const candidates: Candidate[] = [];
    for (const urn of orgUrns) {
      const id = urn.split(':').pop()!;
      const org = await fetch(`https://api.linkedin.com/rest/organizations/${id}`, { headers: linkedinHeaders(token.access_token) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      candidates.push({
        platform: 'linkedin',
        externalId: urn,
        name: org?.localizedName ?? `LinkedIn page ${id}`,
        credentials,
        expiresAt,
        scopes: LINKEDIN_SCOPES,
      });
    }
    return candidates;
  },

  // Programmatic refresh only works for LinkedIn partners that have it enabled; otherwise
  // there is no refresh_token and the user reconnects before the 60 days are up.
  async refresh(creds) {
    if (!creds.refresh_token) throw new ProviderError('LinkedIn tokens cannot be refreshed; reconnect the account');
    const token = await json<{ access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number }>(
      await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({
          grant_type: 'refresh_token',
          refresh_token: creds.refresh_token,
          client_id: process.env.LINKEDIN_CLIENT_ID!,
          client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
        }),
      }),
      'LinkedIn token refresh',
    );
    const expiresAt = inSeconds(token.expires_in);
    return {
      credentials: {
        access_token: token.access_token,
        expires_at: expiresAt,
        refresh_token: token.refresh_token ?? creds.refresh_token,
        refresh_expires_at: inSeconds(token.refresh_token_expires_in) ?? creds.refresh_expires_at,
      },
      expiresAt,
    };
  },
};

// ---------------------------------------------------------------------------
// X: OAuth 2.0 with PKCE. Docs: docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
// Access tokens last 2 hours; refresh tokens rotate (the new one must be saved).
// ---------------------------------------------------------------------------

const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'];

function xBasicAuth() {
  return `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64')}`;
}

async function xToken(params: Record<string, string>, what: string): Promise<RefreshedCredentials> {
  const token = await json<{ access_token: string; expires_in: number; refresh_token?: string }>(
    await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: xBasicAuth() },
      body: form({ ...params, client_id: process.env.X_CLIENT_ID! }),
    }),
    what,
  );
  const expiresAt = inSeconds(token.expires_in);
  return { credentials: { access_token: token.access_token, refresh_token: token.refresh_token, expires_at: expiresAt }, expiresAt };
}

const x: OAuthProvider = {
  id: 'x',
  label: 'X',
  platforms: ['x'],
  pkce: true,
  configured: () => !!(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET),

  authorizeUrl(state, redirectUri, codeChallenge) {
    return `https://x.com/i/oauth2/authorize?${new URLSearchParams({
      response_type: 'code',
      client_id: process.env.X_CLIENT_ID!,
      redirect_uri: redirectUri,
      scope: X_SCOPES.join(' '),
      state,
      code_challenge: codeChallenge!,
      code_challenge_method: 'S256',
    })}`;
  },

  async connect(code, redirectUri, codeVerifier) {
    const { credentials, expiresAt } = await xToken(
      { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier! },
      'X code exchange',
    );
    const me = await json<{ data: { id: string; name: string; username: string; profile_image_url?: string } }>(
      await fetch('https://api.x.com/2/users/me?user.fields=profile_image_url', { headers: { Authorization: `Bearer ${credentials.access_token}` } }),
      'X profile',
    );
    return [{
      platform: 'x',
      externalId: me.data.id,
      name: `@${me.data.username}`,
      avatarUrl: me.data.profile_image_url,
      credentials,
      expiresAt,
      scopes: X_SCOPES,
    }];
  },

  async refresh(creds) {
    if (!creds.refresh_token) throw new ProviderError('No X refresh token; reconnect the account');
    const next = await xToken({ grant_type: 'refresh_token', refresh_token: creds.refresh_token }, 'X token refresh');
    next.credentials.refresh_token ??= creds.refresh_token;
    return next;
  },
};

// ---------------------------------------------------------------------------
// YouTube (Google OAuth). Docs: developers.google.com/identity/protocols/oauth2/web-server
// Access tokens last about an hour; the refresh token is long-lived.
// ---------------------------------------------------------------------------

const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  // Inbox: reading and replying to comments
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

async function googleToken(params: Record<string, string>, what: string) {
  return json<{ access_token: string; expires_in: number; refresh_token?: string }>(
    await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ ...params, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET! }),
    }),
    what,
  );
}

const youtube: OAuthProvider = {
  id: 'youtube',
  label: 'YouTube',
  platforms: ['youtube'],
  configured: () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),

  authorizeUrl(state, redirectUri) {
    return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: YOUTUBE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent', // always return a refresh token
      include_granted_scopes: 'true',
      state,
    })}`;
  },

  async connect(code, redirectUri) {
    const token = await googleToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }, 'Google code exchange');
    const expiresAt = inSeconds(token.expires_in);
    const channels = await json<{ items?: { id: string; snippet: { title: string; thumbnails?: { default?: { url?: string } } } }[] }>(
      await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${token.access_token}` } }),
      'YouTube channel list',
    );
    return (channels.items ?? []).map((c) => ({
      platform: 'youtube' as const,
      externalId: c.id,
      name: c.snippet.title,
      avatarUrl: c.snippet.thumbnails?.default?.url,
      credentials: { access_token: token.access_token, refresh_token: token.refresh_token, expires_at: expiresAt },
      expiresAt,
      scopes: YOUTUBE_SCOPES,
    }));
  },

  async refresh(creds) {
    if (!creds.refresh_token) throw new ProviderError('No YouTube refresh token; reconnect the account');
    const token = await googleToken({ grant_type: 'refresh_token', refresh_token: creds.refresh_token }, 'YouTube token refresh');
    const expiresAt = inSeconds(token.expires_in);
    return { credentials: { access_token: token.access_token, refresh_token: token.refresh_token ?? creds.refresh_token, expires_at: expiresAt }, expiresAt };
  },
};

// ---------------------------------------------------------------------------
// TikTok Login Kit (web). UNVERIFIED: developers.tiktok.com was unreachable when written.
// Access tokens last 24 hours; refresh tokens 365 days.
// ---------------------------------------------------------------------------

// video.list: reading view/like counts for Analytics.
const TIKTOK_SCOPES = ['user.info.basic', 'video.publish', 'video.list'];

async function tiktokToken(params: Record<string, string>, what: string): Promise<RefreshedCredentials & { openId: string }> {
  const token = await json<{ access_token: string; expires_in: number; open_id: string; refresh_token: string; refresh_expires_in: number; error?: string; error_description?: string }>(
    await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ ...params, client_key: process.env.TIKTOK_CLIENT_KEY!, client_secret: process.env.TIKTOK_CLIENT_SECRET! }),
    }),
    what,
  );
  if (token.error) throw new ProviderError(`${what} failed: ${token.error_description ?? token.error}`);
  const expiresAt = inSeconds(token.expires_in);
  return {
    openId: token.open_id,
    expiresAt,
    credentials: { access_token: token.access_token, refresh_token: token.refresh_token, refresh_expires_at: inSeconds(token.refresh_expires_in), expires_at: expiresAt },
  };
}

const tiktok: OAuthProvider = {
  id: 'tiktok',
  label: 'TikTok',
  platforms: ['tiktok'],
  configured: () => !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),

  authorizeUrl(state, redirectUri) {
    return `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      scope: TIKTOK_SCOPES.join(','),
      response_type: 'code',
      redirect_uri: redirectUri,
      state,
    })}`;
  },

  async connect(code, redirectUri) {
    const { credentials, expiresAt, openId } = await tiktokToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }, 'TikTok code exchange');
    const info = await json<{ data?: { user?: { open_id: string; display_name?: string; avatar_url?: string } } }>(
      await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name', { headers: { Authorization: `Bearer ${credentials.access_token}` } }),
      'TikTok profile',
    );
    const user = info.data?.user;
    return [{
      platform: 'tiktok',
      externalId: user?.open_id ?? openId,
      name: user?.display_name ?? 'TikTok account',
      avatarUrl: user?.avatar_url,
      credentials,
      expiresAt,
      scopes: TIKTOK_SCOPES,
    }];
  },

  async refresh(creds) {
    if (!creds.refresh_token) throw new ProviderError('No TikTok refresh token; reconnect the account');
    const { credentials, expiresAt } = await tiktokToken({ grant_type: 'refresh_token', refresh_token: creds.refresh_token }, 'TikTok token refresh');
    return { credentials, expiresAt };
  },
};

// ---------------------------------------------------------------------------
// Threads. Docs: developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions
//                .../threads/get-started/long-lived-tokens
// Long-lived tokens last 60 days and can be refreshed once they are at least 24 hours old.
// ---------------------------------------------------------------------------

const THREADS_SCOPES = ['threads_basic', 'threads_content_publish', 'threads_manage_insights', 'threads_read_replies', 'threads_manage_replies'];
const THREADS_GRAPH = 'https://graph.threads.net';

const threads: OAuthProvider = {
  id: 'threads',
  label: 'Threads',
  platforms: ['threads'],
  configured: () => !!(process.env.THREADS_APP_ID && process.env.THREADS_APP_SECRET),

  authorizeUrl(state, redirectUri) {
    return `https://threads.net/oauth/authorize?${new URLSearchParams({
      client_id: process.env.THREADS_APP_ID!,
      redirect_uri: redirectUri,
      scope: THREADS_SCOPES.join(','),
      response_type: 'code',
      state,
    })}`;
  },

  async connect(code, redirectUri) {
    const short = await json<{ access_token: string; user_id: string }>(
      await fetch(`${THREADS_GRAPH}/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({
          client_id: process.env.THREADS_APP_ID!,
          client_secret: process.env.THREADS_APP_SECRET!,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      }),
      'Threads code exchange',
    );
    const long = await json<{ access_token: string; expires_in: number }>(
      await fetch(`${THREADS_GRAPH}/access_token?${new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: process.env.THREADS_APP_SECRET!, access_token: short.access_token })}`),
      'Threads long-lived token',
    );
    const me = await json<{ id: string; username?: string; threads_profile_picture_url?: string }>(
      await fetch(`${THREADS_GRAPH}/v1.0/me?${new URLSearchParams({ fields: 'id,username,threads_profile_picture_url', access_token: long.access_token })}`),
      'Threads profile',
    );
    const expiresAt = inSeconds(long.expires_in);
    return [{
      platform: 'threads',
      externalId: me.id,
      name: me.username ? `@${me.username}` : 'Threads account',
      avatarUrl: me.threads_profile_picture_url,
      credentials: { access_token: long.access_token, expires_at: expiresAt },
      expiresAt,
      scopes: THREADS_SCOPES,
    }];
  },

  async refresh(creds) {
    const token = await json<{ access_token: string; expires_in: number }>(
      await fetch(`${THREADS_GRAPH}/refresh_access_token?${new URLSearchParams({ grant_type: 'th_refresh_token', access_token: creds.access_token })}`),
      'Threads token refresh',
    );
    const expiresAt = inSeconds(token.expires_in);
    return { credentials: { access_token: token.access_token, expires_at: expiresAt }, expiresAt };
  },
};

export const PROVIDERS: Record<ProviderId, OAuthProvider> = { meta, linkedin, x, youtube, tiktok, threads };

/** Which provider connects (and refreshes tokens for) each platform. */
export const PLATFORM_PROVIDER: Record<Platform, ProviderId> = {
  facebook: 'meta',
  instagram: 'meta',
  linkedin: 'linkedin',
  x: 'x',
  youtube: 'youtube',
  tiktok: 'tiktok',
  threads: 'threads',
};

export function getProvider(id: string): OAuthProvider | null {
  return id in PROVIDERS ? PROVIDERS[id as ProviderId] : null;
}

export function redirectUriFor(provider: ProviderId): string {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return `${base}/api/oauth/${provider}/callback`;
}
