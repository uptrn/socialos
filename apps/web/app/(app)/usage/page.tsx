import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { monthlyBudget } from '@/lib/ai/gateway';
import { createUserClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'AI usage' };

const AGENT_LABELS: Record<string, string> = { content: 'Write with AI', qa: 'AI check', research: 'Research (web search)', 'research-structure': 'Research (organizing)', graphics: 'Creative (slide text)', image: 'AI images' };

export default async function UsagePage() {
  const ws = await getWorkspace();
  const supabase = await createUserClient();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const { data: runs } = await supabase
    .from('agent_runs')
    .select('id, agent, model, status, cost_usd, input_tokens, output_tokens, created_at, brands(name)')
    .eq('org_id', ws.org.id)
    .gte('created_at', monthStart)
    .order('created_at', { ascending: false })
    .limit(500);

  const budget = await monthlyBudget(ws.org.id);
  const rows = runs ?? [];
  const spent = rows.reduce((sum, r) => sum + Number(r.cost_usd), 0);
  const byAgent = Object.entries(
    rows.reduce<Record<string, { count: number; cost: number }>>((acc, r) => {
      acc[r.agent] ??= { count: 0, cost: 0 };
      acc[r.agent]!.count += 1;
      acc[r.agent]!.cost += Number(r.cost_usd);
      return acc;
    }, {}),
  );
  const pct = Math.min(100, (spent / budget) * 100);
  const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

  return (
    <>
      <PageHeader title="AI usage" description={`${ws.org.name} · this month`} />
      <div className="grid gap-5 md:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-muted">Spent this month</p>
          <p className="tabular mt-1 text-2xl font-bold">{usd(spent)}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
            <div className={pct >= 90 ? 'h-full bg-danger' : 'bg-brand-gradient h-full'} style={{ width: `${pct}%` }} />
          </div>
          <p className="tabular mt-1 text-xs text-muted">of ${budget} monthly AI budget</p>
        </Card>
        {byAgent.map(([agent, v]) => (
          <Card key={agent} className="p-5">
            <p className="text-sm text-muted">{AGENT_LABELS[agent] ?? agent}</p>
            <p className="tabular mt-1 text-2xl font-bold">{v.count}</p>
            <p className="tabular text-xs text-muted">runs · {usd(v.cost)}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5">When</th>
              <th className="px-4 py-2.5">Feature</th>
              <th className="px-4 py-2.5">Brand</th>
              <th className="px-4 py-2.5">Result</th>
              <th className="px-4 py-2.5 text-right">Tokens</th>
              <th className="px-4 py-2.5 text-right">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.slice(0, 100).map((r) => (
              <tr key={r.id}>
                <td className="tabular px-4 py-2.5 text-muted">{new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="px-4 py-2.5">{AGENT_LABELS[r.agent] ?? r.agent}</td>
                <td className="px-4 py-2.5">{(r.brands as unknown as { name: string } | null)?.name ?? '—'}</td>
                <td className={`px-4 py-2.5 ${r.status === 'succeeded' ? 'text-success' : 'text-warning'}`}>{r.status.replace('_', ' ')}</td>
                <td className="tabular px-4 py-2.5 text-right text-muted">{(r.input_tokens + r.output_tokens).toLocaleString()}</td>
                <td className="tabular px-4 py-2.5 text-right">{usd(Number(r.cost_usd))}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">No AI usage this month.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
