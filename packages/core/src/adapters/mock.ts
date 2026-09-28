import type { Platform } from '../platforms/types';
import { PublishError, type PublishErrorClass } from './errors';
import type { AccountCredentials, PublishRequest, PublishResult, SocialAdapter } from './types';

/**
 * Stand-in adapter for development and tests. It never contacts a platform.
 *
 * Put a marker in the caption to simulate an outcome:
 *   [mock:fail-transient] [mock:fail-rate_limited] [mock:fail-auth_expired]
 *   [mock:fail-invalid_content] [mock:fail-ambiguous] [mock:fail-permanent]
 *   [mock:processing]  -> returns "processing" once, then publishes on resume
 */
export class MockAdapter implements SocialAdapter {
  readonly published: PublishRequest[] = [];
  private counter = 0;

  constructor(readonly platform: Platform) {}

  async publish(_account: AccountCredentials, request: PublishRequest): Promise<PublishResult> {
    const failure = request.caption.match(/\[mock:fail-([a-z_]+)\]/);
    if (failure) {
      const errorClass = failure[1] as PublishErrorClass;
      throw new PublishError(errorClass, `Simulated ${errorClass} failure`, {
        retryAfterSec: errorClass === 'rate_limited' ? 120 : undefined,
      });
    }
    if (request.caption.includes('[mock:processing]') && !request.resumeState) {
      return { status: 'processing', checkAfterSec: 30, resumeState: { step: 'uploaded' } };
    }
    return this.complete(request);
  }

  async resume(account: AccountCredentials, request: PublishRequest): Promise<PublishResult> {
    return this.complete(request);
  }

  private complete(request: PublishRequest): PublishResult {
    this.published.push(request);
    this.counter += 1;
    const externalPostId = `mock_${this.platform}_${this.counter}_${request.jobId.slice(0, 8)}`;
    return {
      status: 'published',
      externalPostId,
      url: `https://example.com/${this.platform}/posts/${externalPostId}`,
      publishedAt: new Date(),
    };
  }
}

export function createMockRegistry(platforms: Platform[]): Record<string, MockAdapter> {
  return Object.fromEntries(platforms.map((p) => [p, new MockAdapter(p)]));
}
