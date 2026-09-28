'use client';

import { useState, useTransition } from 'react';
import { setBrandApproval } from './actions';

export function ApprovalToggle({ brandId, brandName, initial }: { brandId: string; brandName: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
      <input
        type="checkbox"
        role="switch"
        checked={on}
        disabled={pending}
        aria-label={`Require approval for ${brandName}`}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          start(async () => {
            const res = await setBrandApproval(brandId, next);
            if (res.error) {
              setOn(!next);
              setError(res.error);
            } else setError(undefined);
          });
        }}
        className="h-4 w-4 accent-[var(--brand-blue)]"
      />
      Require approval
      {error && <span className="text-danger">{error}</span>}
    </label>
  );
}
