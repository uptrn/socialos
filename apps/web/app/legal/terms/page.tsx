import type { Metadata } from 'next';
import Link from 'next/link';
import { PAYMENT_GRACE_DAYS, TRIAL_DAYS } from '@socialos/core';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Terms of Service' };

// Template. Review with a lawyer before launch (liability caps, refunds and governing law especially).
export default function TermsPage() {
  const { product, company, email, jurisdiction, effectiveDate } = LEGAL;
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="meta">Effective {effectiveDate}</p>

      <p>
        These terms are an agreement between {company} (&quot;we&quot;) and the organization or person using {product} (&quot;you&quot;). By creating an account or using {product}
        you accept them. If you use {product} for an organization, you confirm you may accept these terms on its behalf.
      </p>

      <h2>1. The service</h2>
      <p>
        {product} helps you research, create, approve, schedule and publish social media content, read comments and metrics, and use AI features to do so. Features depend on your
        plan and on what each social platform allows.
      </p>

      <h2>2. Accounts and your team</h2>
      <ul>
        <li>Keep your login secure; you&apos;re responsible for activity in your organization, including by people you invite.</li>
        <li>Owners and admins decide who has access and what role they have.</li>
      </ul>

      <h2>3. Social platforms</h2>
      <p>
        When you connect a social account you confirm you are authorized to manage it. You must follow each platform&apos;s terms and policies. {product} isn&apos;t affiliated with or
        endorsed by Meta, LinkedIn, X, Google/YouTube or TikTok. Platforms can change or limit their APIs at any time; we&apos;ll work to keep features running but can&apos;t guarantee a
        platform will accept, keep or display a post.
      </p>

      <h2>4. Your content</h2>
      <p>
        You own the content you upload or create in {product}. You give us permission to store, process and transmit it only as needed to provide the service (for example, to
        publish it to the accounts you choose). You&apos;re responsible for having the rights to your content and for what you publish.
      </p>

      <h2>5. AI features</h2>
      <p>
        AI features produce suggestions that can be inaccurate or unsuitable. Review everything before publishing. You&apos;re responsible for content you publish, including AI-generated
        text and images, and for labeling AI content where a platform or law requires it. AI usage is limited by the monthly budget of your plan.
      </p>

      <h2>6. Acceptable use</h2>
      <p>Don&apos;t use {product} to:</p>
      <ul>
        <li>send spam, manipulate engagement or evade a platform&apos;s limits or enforcement;</li>
        <li>publish unlawful, deceptive, infringing, hateful or harassing content;</li>
        <li>access accounts you&apos;re not authorized to manage;</li>
        <li>interfere with or reverse engineer the service, or resell it without our agreement.</li>
      </ul>
      <p>We may suspend accounts that break these rules or put the service or others at risk.</p>

      <h2>7. Plans, trial and payment</h2>
      <ul>
        <li>New organizations get a {TRIAL_DAYS}-day free trial. No card is needed; when it ends, choose a plan to keep publishing.</li>
        <li>Paid plans are billed in advance, monthly or yearly, through Stripe, and renew automatically until cancelled.</li>
        <li>You can cancel at any time in Settings → Billing; access continues until the end of the paid period. [Refund policy: e.g. no refunds for partial periods, except where required by law.]</li>
        <li>If a payment fails, the service keeps working for {PAYMENT_GRACE_DAYS} days; after that the workspace becomes read-only until payment succeeds.</li>
        <li>We&apos;ll give at least 30 days&apos; notice of price changes, which apply from your next renewal.</li>
        <li>Prices exclude taxes, which are added where applicable.</li>
      </ul>

      <h2>8. Ending the agreement</h2>
      <p>
        You can stop using {product} and delete your organization or account at any time (Settings → Danger zone). We may end the agreement with notice, or immediately for serious
        breaches. After an organization is deleted its data is removed as described in the <Link href="/legal/privacy">Privacy Policy</Link>.
      </p>

      <h2>9. Warranties and liability</h2>
      <p>
        The service is provided &quot;as is&quot;. To the extent the law allows, we disclaim implied warranties, and our total liability for any claim is limited to the amount you paid us in
        the 12 months before the claim. We aren&apos;t liable for indirect or consequential losses, lost profits, or for actions of social platforms. [Review with counsel.]
      </p>

      <h2>10. Indemnity</h2>
      <p>You&apos;ll defend and indemnify us against claims arising from your content or your breach of these terms or of a platform&apos;s terms.</p>

      <h2>11. Changes</h2>
      <p>We may update these terms. We&apos;ll notify owners of material changes by email at least 30 days before they apply. Continuing to use the service means you accept them.</p>

      <h2>12. Law</h2>
      <p>These terms are governed by the laws of {jurisdiction}, and its courts have exclusive jurisdiction, unless your local law requires otherwise.</p>

      <h2>13. Contact</h2>
      <p>
        <a href={`mailto:${email}`}>{email}</a>
      </p>
    </>
  );
}
