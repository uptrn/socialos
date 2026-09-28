import type { PlatformOptions } from '../platforms/options';
import type { MediaInfo, Platform, PostType } from '../platforms/types';

/** A connected social account, with decrypted credentials supplied by the caller. */
export interface AccountCredentials {
  socialAccountId: string;
  platform: Platform;
  externalAccountId: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
}

export interface PublishMedia extends MediaInfo {
  /** Short-lived public URL the platform can fetch (signed storage URL). */
  url: string;
  /**
   * Same file served from the app's own domain. Needed by platforms that only pull
   * from domains you have verified with them (TikTok photo posts).
   */
  proxyUrl?: string;
  altText?: string;
  /** Made by an AI image model; labeled as AI content where the platform supports it. */
  aiGenerated?: boolean;
}

export interface PublishRequest<P extends Platform = Platform> {
  jobId: string;
  idempotencyKey: string;
  platform: P;
  postType: PostType;
  caption: string;
  threadParts?: string[];
  media: PublishMedia[];
  options: PlatformOptions[P];
  /** Opaque state from a previous "processing" result, for multi-step uploads. */
  resumeState?: Record<string, unknown>;
}

export type PublishResult =
  | {
      status: 'published';
      externalPostId: string;
      url?: string;
      publishedAt: Date;
      /** The post is live but something secondary failed (e.g. a later part of a thread). */
      warning?: string;
    }
  | {
      /** Platform is still processing (e.g. video transcode). Poll again later. */
      status: 'processing';
      checkAfterSec: number;
      resumeState: Record<string, unknown>;
    };

export interface SocialAdapter {
  platform: Platform;
  publish(account: AccountCredentials, request: PublishRequest): Promise<PublishResult>;
  /** Continue a publish that returned "processing". */
  resume(account: AccountCredentials, request: PublishRequest): Promise<PublishResult>;
}

export type AdapterRegistry = Partial<Record<Platform, SocialAdapter>>;
