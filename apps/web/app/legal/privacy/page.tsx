import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Privacy Policy' };

// Template that reflects how SocialOS actually handles data. Review with a lawyer before launch.
export default function PrivacyPage() {
  const { product, company, email, address, effectiveDate } = LEGAL;
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="meta">Effective {effectiveDate}</p>

      <p>
        This policy explains what personal data {product} (operated by {company}, {address}, &quot;we&quot;) collects, why, who we share it with, and the choices you have.
        Questions: <a href={`mailto:${email}`}>{email}</a>.
      </p>

      <h2>1. Who this applies to</h2>
      <p>
        {product} is a service businesses use to manage their social media. It applies to people who sign up or are invited to a workspace (&quot;users&quot;), and to people whose
        public comments on our customers&apos; posts we process on our customers&apos; behalf. For that comment data, our customer is the controller and we act as their processor.
      </p>

      <h2>2. Data we collect</h2>
      <ul>
        <li><b>Account data:</b> your email address, a password (stored hashed by our authentication provider), your organizations, brands, team roles and invitations.</li>
        <li>
          <b>Connected social accounts:</b> when you connect a Facebook Page, Instagram, Threads, LinkedIn Page, X, YouTube or TikTok account, we receive the account&apos;s id, name,
          picture and access tokens for the permissions you approve. Tokens are encrypted and kept in a separate secrets store; they are never shown in the app.
        </li>
        <li>
          <b>Your content:</b> posts, captions, images, videos and documents you upload or generate, schedules, brand guidelines (&quot;Brand Brain&quot;), research ideas and
          approval notes.
        </li>
        <li>
          <b>Data from social platforms about your posts:</b> publishing status, performance metrics (views, likes, comments, shares and similar), and comments on your posts,
          including the commenter&apos;s public name or username and the comment text.
        </li>
        <li>
          <b>Tracked links and conversions:</b> when someone clicks a {product} tracked link in a post, we record the time, the link, the visitor&apos;s country and the referring
          site, and an anonymous visitor id made from a one-way hash of their IP address and browser with a secret that changes every day. We don&apos;t store IP addresses. If our
          customer installs our snippet on their website, it keeps the click id in a first-party cookie on that site for up to 90 days, and the site reports conversions (for
          example a signup or purchase, with an optional value and order id) linked to that click. Customers are responsible for telling their visitors and collecting consent
          where the law requires.
        </li>
        <li><b>Billing data:</b> your plan and subscription status. Card details are collected and stored by Stripe, not by us.</li>
        <li>
          <b>Technical data:</b> logs of actions in the workspace (audit log), AI usage records (what feature was used, cost and a short summary of the request), and standard
          server logs from our hosting providers (such as IP address and browser type).
        </li>
      </ul>
      <p>We only use cookies that are needed for the service to work: your sign-in session and which organization and brand you have selected. We don&apos;t use advertising or third-party analytics cookies.</p>

      <h2>3. How we use it</h2>
      <ul>
        <li>To provide the service: publish and schedule posts, show analytics and comments, send replies you write, and run the AI features you use.</li>
        <li>To send service emails: alerts about failed posts or disconnected accounts, invitations, approval requests and billing notices.</li>
        <li>To bill you, prevent abuse, keep the service secure, and meet legal obligations.</li>
      </ul>
      <p>
        We don&apos;t sell personal data, don&apos;t use it for advertising, and don&apos;t use data received from social platforms for any purpose other than providing the features you use.
      </p>

      <h2>4. AI features</h2>
      <p>
        When you use an AI feature (writing or checking posts, research, graphics text, image generation, insights or reply suggestions), the relevant content is sent to an AI
        provider to produce the result: for example your brand guidelines and draft, or a comment and the post it is on. Results are suggestions: nothing is published without a
        person choosing to publish it. Providers process this data under their terms for business customers.
      </p>

      <h2>5. Who we share data with</h2>
      <p>We use these service providers (&quot;subprocessors&quot;) to run {product}:</p>
      <ul>
        <li>Supabase: database, authentication and file storage.</li>
        <li>[Hosting provider, e.g. Vercel]: application hosting.</li>
        <li>Stripe: payments and subscriptions.</li>
        <li>Resend: sending email.</li>
        <li>Anthropic: AI text features.</li>
        <li>Cloudflare, Google (Gemini) and OpenAI: AI image generation, only when you choose that option.</li>
        <li>Pexels: stock photo search (your search terms).</li>
        <li>The social platforms you connect, to publish your content and read metrics and comments.</li>
      </ul>
      <p>We may also disclose data if required by law, or as part of a merger or acquisition, in which case this policy continues to apply.</p>

      <h2>6. Social platforms</h2>
      <h3>YouTube and Google</h3>
      <p>
        {product} uses YouTube API Services. By connecting a YouTube channel you agree to the <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>, and
        Google&apos;s use of data is described in the <a href="https://policies.google.com/privacy">Google Privacy Policy</a>. You can revoke {product}&apos;s access at any time in
        your <a href="https://myaccount.google.com/permissions">Google account permissions</a>. {product}&apos;s use and transfer of information received from Google APIs adheres to
        the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.
      </p>
      <h3>Meta (Facebook, Instagram, Threads), LinkedIn, X and TikTok</h3>
      <p>
        We access these platforms only with the permissions you approve when connecting an account, and only to provide the features described above. You can remove access in{' '}
        {product} (Accounts → Disconnect) or in the platform&apos;s own settings. See <Link href="/legal/data-deletion">Data deletion</Link> for how to have your data removed.
      </p>

      <h2>7. Security</h2>
      <p>
        Data is encrypted in transit. Access to each organization&apos;s data is restricted to its members by database-level rules. Platform access tokens are stored encrypted in a
        separate secrets store. We limit staff access to what is needed to operate and support the service.
      </p>

      <h2>8. How long we keep data</h2>
      <p>
        We keep your data while your account or organization exists. When an organization is deleted, its content, files, connected accounts (and their tokens), metrics and
        comments are deleted immediately from the live service; backups are overwritten within [30] days. Billing records are kept as long as tax law requires. Comments and metrics
        stop being collected 30 days after a post is published.
      </p>

      <h2>9. Your rights</h2>
      <p>
        Depending on where you live (for example under GDPR or CCPA) you can ask to access, correct, export or delete your personal data, object to or restrict processing, and
        withdraw consent. You can delete your account and organizations yourself in Settings, or email <a href={`mailto:${email}`}>{email}</a>. You can also complain to your data
        protection authority. If you commented on a post managed with {product}, contact the brand that owns the post, or us and we&apos;ll pass your request on.
      </p>

      <h2>10. International transfers</h2>
      <p>Our providers may process data outside your country. Where required, transfers are covered by appropriate safeguards such as Standard Contractual Clauses. [Confirm regions.]</p>

      <h2>11. Children</h2>
      <p>{product} is a business service and is not intended for anyone under 16.</p>

      <h2>12. Changes</h2>
      <p>We&apos;ll post changes here and, for significant changes, notify account owners by email before they take effect.</p>
    </>
  );
}
