import { Async, Card, Empty, PageTitle, useLoad } from '../components/ui';
import { get } from '../api';

const n = (v: number) => Number(v || 0).toLocaleString();

/** Platform admin: how much the AI provider has been used, in the tokens the provider itself reported, and an estimated cost when prices are set. */
export function AiUsage() {
  const s = useLoad(() => get('/admin/ai'));
  return <div className="col">
    <PageTitle title="AI usage and cost" sub="Tokens are the counts your AI provider reports. Cost is an estimate, not a bill." />
    <Async s={s}>{d => <>
      <Card className="col">
        <div><b>Provider:</b> {d.provider}{d.configured ? ` (${d.model})` : ''}</div>
        {d.cost.calls === 0 ? <Empty title="No model calls recorded yet" text="Counts appear after the first AI answer from a real provider." /> : <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
          <div><div className="muted">Calls</div><b>{n(d.cost.calls)}</b></div>
          <div><div className="muted">Input tokens</div><b>{n(d.cost.inputTokens)}</b></div>
          <div><div className="muted">Output tokens</div><b>{n(d.cost.outputTokens)}</b></div>
          <div><div className="muted">Estimated cost, all time</div><b>{d.cost.priced ? `${d.cost.currency} ${d.cost.total}` : 'Not set'}</b></div>
          <div><div className="muted">Estimated cost, this month</div><b>{d.cost.priced ? `${d.cost.currency} ${d.cost.thisMonth}` : 'Not set'}</b></div>
        </div>}
        {!d.cost.priced && <p className="muted" style={{ margin: 0 }}>To see a cost estimate, set LLM_PRICE_IN_PER_MTOK and LLM_PRICE_OUT_PER_MTOK to your provider’s price per million tokens, then restart.</p>}
      </Card>
      {d.tokensByDay.length > 0 && <Card className="col"><h2 style={{ margin: 0 }}>Last 14 days</h2>
        <table className="table"><thead><tr><th>Day</th><th>Calls</th><th>Input tokens</th><th>Output tokens</th></tr></thead>
          <tbody>{d.tokensByDay.map((r: any) => <tr key={r.day}><td>{r.day}</td><td>{n(r.calls)}</td><td>{n(r.input_tokens)}</td><td>{n(r.output_tokens)}</td></tr>)}</tbody></table></Card>}
    </>}</Async>
  </div>;
}
