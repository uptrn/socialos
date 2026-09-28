import 'server-only';
import {
  FacebookPageAdapter,
  InstagramAdapter,
  LinkedInAdapter,
  ThreadsAdapter,
  TikTokAdapter,
  XAdapter,
  YouTubeAdapter,
  MockAdapter,
  PLATFORMS,
  PublishError,
  type AdapterRegistry,
  type Platform,
  type SocialAdapter,
} from '@socialos/core';
import { serverEnv } from '../env';
import { LINKEDIN_API_VERSION, META_GRAPH_VERSION, PROVIDERS } from '../oauth/providers';

// A platform's real adapter is active once its app credentials are configured.
function realAdapters(): Partial<Record<Platform, SocialAdapter>> {
  const adapters: Partial<Record<Platform, SocialAdapter>> = {};
  if (PROVIDERS.meta.configured()) {
    adapters.facebook = new FacebookPageAdapter({ graphVersion: META_GRAPH_VERSION });
    adapters.instagram = new InstagramAdapter({ graphVersion: META_GRAPH_VERSION });
  }
  if (PROVIDERS.linkedin.configured()) {
    adapters.linkedin = new LinkedInAdapter({ apiVersion: LINKEDIN_API_VERSION });
  }
  if (PROVIDERS.x.configured()) adapters.x = new XAdapter();
  if (PROVIDERS.youtube.configured()) adapters.youtube = new YouTubeAdapter();
  if (PROVIDERS.tiktok.configured()) adapters.tiktok = new TikTokAdapter();
  if (PROVIDERS.threads.configured()) adapters.threads = new ThreadsAdapter();
  return adapters;
}

export const MOCK_ACCOUNT_PREFIX = 'mock-';

/**
 * Per platform: simulated accounts go to the mock adapter (dev only),
 * everything else to the real adapter for that platform.
 */
export function createAdapterRegistry(): AdapterRegistry {
  const mocksEnabled = serverEnv.mockAccountsEnabled();
  const registry: AdapterRegistry = {};
  const reals = realAdapters();

  for (const platform of PLATFORMS) {
    const mock = new MockAdapter(platform);
    const real = reals[platform];
    const pick = (externalAccountId: string): SocialAdapter => {
      if (externalAccountId.startsWith(MOCK_ACCOUNT_PREFIX)) {
        if (!mocksEnabled) throw new PublishError('permanent', 'Simulated accounts are disabled in this environment');
        return mock;
      }
      if (!real) throw new PublishError('permanent', `Publishing to ${platform} is not available yet`);
      return real;
    };
    registry[platform] = {
      platform,
      publish: (account, request) => pick(account.externalAccountId).publish(account, request),
      resume: (account, request) => pick(account.externalAccountId).resume(account, request),
    };
  }
  return registry;
}
