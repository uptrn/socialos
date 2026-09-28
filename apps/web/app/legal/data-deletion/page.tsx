import type { Metadata } from 'next';
import Link from 'next/link';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Data deletion' };

// Also used as the "Data Deletion Instructions URL" in the Meta app settings.
export default function DataDeletionPage() {
  const { product, email } = LEGAL;
  return (
    <>
      <h1>Deleting your data</h1>
      <p>You can remove your data from {product} yourself at any time, or ask us to do it.</p>

      <h2>Disconnect a social account</h2>
      <p>
        In {product}, go to <b>Accounts</b> and choose <b>Disconnect</b>. We delete the stored access for that account straight away and stop reading its data. Its past posts stay in
        your workspace until you delete them or the organization.
      </p>

      <h2>Delete an organization</h2>
      <p>
        An owner can go to <b>Settings → Danger zone → Delete organization</b>. This cancels the subscription and immediately deletes all brands, posts, media files, connected
        accounts and their stored access, analytics, comments and team access. Backups are overwritten within [30] days.
      </p>

      <h2>Delete your account</h2>
      <p>
        Go to <b>Settings → Danger zone → Delete my account</b>. This removes your login and your access to every organization. If you&apos;re the only owner of an organization, make
        someone else an owner or delete the organization first.
      </p>

      <h2>Removed {product} from Facebook, Instagram, Threads or another platform?</h2>
      <p>
        Removing the app in a platform&apos;s settings stops our access, but data we already stored stays until you delete it as described above. If you no longer have access to{' '}
        {product}, email <a href={`mailto:${email}?subject=Data%20deletion%20request`}>{email}</a> with the name of the Page or account. We&apos;ll confirm your identity, delete the data
        within 30 days and reply with a confirmation.
      </p>

      <h2>You commented on a post managed with {product}</h2>
      <p>
        Comments are read from the platform on behalf of the brand that owns the post. Deleting your comment on the platform stops it being read again. To have a copy removed from{' '}
        {product}, contact the brand, or email us and we&apos;ll pass the request on.
      </p>

      <p>
        More details: <Link href="/legal/privacy">Privacy Policy</Link>.
      </p>
    </>
  );
}
