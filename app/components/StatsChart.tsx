'use client';

import { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

type ChartKind = 'bar' | 'line' | 'pie';

interface ChartSeries {
  key: string;
  label?: string;
  color?: string;
}

interface ChartPayload {
  type?: ChartKind;
  title?: string;
  subtitle?: string;
  xKey: string;
  series: ChartSeries[];
  data: Record<string, string | number>[];
}

const DEFAULT_COLORS = ['#10b981', '#f59e0b', '#38bdf8', '#a78bfa', '#f43f5e', '#34d399'];

export function StatsChart({ rawJson }: { rawJson: string }) {
  const parsed = useMemo<{ payload: ChartPayload | null; error: string | null }>(() => {
    try {
      const obj = JSON.parse(rawJson.trim()) as ChartPayload;
      if (!obj.xKey || !Array.isArray(obj.series) || !Array.isArray(obj.data)) {
        return { payload: null, error: 'Structură JSON invalidă pentru grafic.' };
      }
      return { payload: obj, error: null };
    } catch (err: unknown) {
      return {
        payload: null,
        error: err instanceof Error ? err.message : 'Eroare la parsarea graficului.',
      };
    }
  }, [rawJson]);

  const [chartType, setChartType] = useState<ChartKind>(parsed.payload?.type || 'bar');

  if (parsed.error || !parsed.payload) {
    return (
      <div className="my-3 rounded-xl border border-amber-500/30 bg-zinc-950 p-3 text-xs">
        <p className="mb-2 font-medium text-amber-400">⚠️ Date grafic brute:</p>
        <pre className="overflow-x-auto font-mono text-[11px] text-zinc-300">{rawJson}</pre>
      </div>
    );
  }

  const { title, subtitle, xKey, series, data } = parsed.payload;

  function downloadCsv() {
    const headers = [xKey, ...series.map((s) => s.label || s.key)];
    const rows = data.map((row) =>
      [row[xKey], ...series.map((s) => row[s.key] ?? '')]
        .map((val) => `"${String(val).replace(/"/g, '""')}"`)
        .join(',')
    );
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `statistici-alumni-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-950">
      {/* Header grafic */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/90 px-3.5 py-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-sky-400">
              📊 Statistici
            </span>
            {title && <h4 className="text-xs font-semibold text-zinc-100">{title}</h4>}
          </div>
          {subtitle && <p className="text-[11px] text-zinc-400">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-1 text-[11px]">
          {(['bar', 'line', 'pie'] as ChartKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setChartType(kind)}
              className={`rounded px-2 py-0.5 font-mono uppercase transition ${
                chartType === kind
                  ? 'border border-sky-500/40 bg-sky-500/20 text-sky-300'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
            >
              {kind}
            </button>
          ))}
          <button
            type="button"
            onClick={downloadCsv}
            className="ml-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-200 hover:border-emerald-500/50"
          >
            CSV
          </button>
        </div>
      </div>

      {/* Zonă randare Recharts */}
      <div className="h-[320px] w-full p-4">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'line' ? (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey={xKey} stroke="#a1a1aa" fontSize={11} />
              <YAxis stroke="#a1a1aa" fontSize={11} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  borderColor: '#3f3f46',
                  borderRadius: '0.75rem',
                  fontSize: '12px',
                  color: '#f4f4f5',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              {series.map((s, idx) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label || s.key}
                  stroke={s.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]}
                  strokeWidth={2.5}
                  dot={{ r: 4 }}
                />
              ))}
            </LineChart>
          ) : chartType === 'pie' && series.length > 0 ? (
            <PieChart>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  borderColor: '#3f3f46',
                  borderRadius: '0.75rem',
                  fontSize: '12px',
                  color: '#f4f4f5',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Pie
                data={data}
                dataKey={series[0].key}
                nameKey={xKey}
                cx="50%"
                cy="50%"
                outerRadius={100}
                label
              >
                {data.map((_, idx) => (
                  <Cell key={idx} fill={DEFAULT_COLORS[idx % DEFAULT_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey={xKey} stroke="#a1a1aa" fontSize={11} />
              <YAxis stroke="#a1a1aa" fontSize={11} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  borderColor: '#3f3f46',
                  borderRadius: '0.75rem',
                  fontSize: '12px',
                  color: '#f4f4f5',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              {series.map((s, idx) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label || s.key}
                  fill={s.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]}
                  radius={[6, 6, 0, 0]}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}