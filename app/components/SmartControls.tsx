'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DEPARTMENTS, Person, TaskItem } from '../lib/pmp-types';

/* =========================================================================
   1. SEARCHABLE ALUMNI PICKER (CU LOAD INDICATOR)
   ========================================================================= */
interface AlumniSearchPickerProps {
  people: Person[];
  tasks?: TaskItem[];
  value: string | null;
  onChange: (personId: string | null) => void;
  placeholder?: string;
}

export function AlumniSearchPicker({
  people,
  tasks = [],
  value,
  onChange,
  placeholder = 'Caută alumn după nume, rol, departament...',
}: AlumniSearchPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const loadByPerson = useMemo(() => {
    const map = new Map<string, { count: number; hours: number }>();
    for (const t of tasks) {
      if (!t.assignee_id || t.status === 'done') continue;
      const cur = map.get(t.assignee_id) || { count: 0, hours: 0 };
      cur.count += 1;
      cur.hours += Number(t.estimated_hours || 0);
      map.set(t.assignee_id, cur);
    }
    return map;
  }, [tasks]);

  const selectedPerson = useMemo(
    () => people.find((p) => p.id === value) || null,
    [people, value]
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return people.slice(0, 40);
    return people
      .filter(
        (p) =>
          p.full_name.toLowerCase().includes(q) ||
          p.role.toLowerCase().includes(q) ||
          p.department.toLowerCase().includes(q) ||
          (p.location || '').toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [people, query]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-left text-xs text-zinc-200 transition hover:border-zinc-500"
      >
        {selectedPerson ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 font-mono text-[10px] font-bold text-emerald-300">
              {selectedPerson.full_name.charAt(0)}
            </span>
            <span className="truncate font-medium text-zinc-100">
              {selectedPerson.full_name}
            </span>
            <span className="truncate text-[10px] text-zinc-400">
              ({selectedPerson.role})
            </span>
          </div>
        ) : (
          <span className="text-zinc-500">Nealocat (click pentru căutare)</span>
        )}
        <span className="text-[10px] text-zinc-500">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1.5 w-80 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
          <div className="border-b border-zinc-800 p-2">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="max-h-60 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-800"
            >
              — Nealocat
            </button>

            {filtered.length === 0 ? (
              <p className="py-4 text-center text-xs text-zinc-500">
                Niciun alumn găsit pentru „{query}”.
              </p>
            ) : (
              filtered.map((p) => {
                const dept = DEPARTMENTS[p.department] || DEPARTMENTS.Comunitati;
                const load = loadByPerson.get(p.id);
                const isSelected = p.id === value;

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      onChange(p.id);
                      setOpen(false);
                      setQuery('');
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                      isSelected
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : 'text-zinc-200 hover:bg-zinc-800'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.full_name}</div>
                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                        <span>{p.role}</span>
                        <span>·</span>
                        <span className={dept.badgeText}>{dept.label}</span>
                        {p.location && <span>· {p.location}</span>}
                      </div>
                    </div>

                    <div className="shrink-0 font-mono text-[10px]">
                      {load ? (
                        <span
                          className={`rounded px-1.5 py-0.5 ${
                            load.hours >= 12
                              ? 'bg-rose-500/20 text-rose-300'
                              : load.hours >= 6
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {load.count}t · {load.hours}h
                        </span>
                      ) : (
                        <span className="text-zinc-600">0t</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   2. VISUAL CALENDAR RANGE PICKER (START DATE -> DEADLINE)
   ========================================================================= */
interface CalendarRangePickerProps {
  startDate: string | null;
  endDate: string | null;
  onChange: (start: string | null, end: string | null) => void;
  openUpward?: boolean;
  alignRight?: boolean;
}

const WEEKDAYS_RO = ['Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ', 'Du'];
const MONTHS_RO = [
  'Ianuarie',
  'Februarie',
  'Martie',
  'Aprilie',
  'Mai',
  'Iunie',
  'Iulie',
  'August',
  'Septembrie',
  'Octombrie',
  'Noiembrie',
  'Decembrie',
];

function toIsoDate(y: number, mZero: number, d: number): string {
  return new Date(Date.UTC(y, mZero, d)).toISOString().slice(0, 10);
}

export function CalendarRangePicker({
  startDate,
  endDate,
  onChange,
  openUpward = false,
  alignRight = false,
}: CalendarRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [todayIso, setTodayIso] = useState<string>('');
  const [viewYear, setViewYear] = useState<number>(2026);
  const [viewMonth, setViewMonth] = useState<number>(10);
  const [pickingEnd, setPickingEnd] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const now = new Date();
    const iso = now.toISOString().slice(0, 10);
    setTodayIso(iso);
    if (startDate) {
      const [y, m] = startDate.split('-').map(Number);
      setViewYear(y);
      setViewMonth(m - 1);
    } else {
      setViewYear(now.getUTCFullYear());
      setViewMonth(now.getUTCMonth());
    }
  }, [startDate]);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const calendarCells = useMemo(() => {
    const firstDayOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
    const startWeekday = (firstDayOfMonth.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();

    const cells: (string | null)[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(toIsoDate(viewYear, viewMonth, d));
    }
    return cells;
  }, [viewYear, viewMonth]);

  function handleDayClick(iso: string) {
    if (!pickingEnd || !startDate) {
      onChange(iso, iso);
      setPickingEnd(true);
    } else {
      if (iso < startDate) {
        onChange(iso, startDate);
      } else {
        onChange(startDate, iso);
      }
      setPickingEnd(false);
      setOpen(false);
    }
  }

  function applyQuickPreset(offsetDays: number) {
    const base = new Date();
    const s = base.toISOString().slice(0, 10);
    const e = new Date(base.getTime() + offsetDays * 86400000).toISOString().slice(0, 10);
    onChange(s, e);
    setPickingEnd(false);
    setOpen(false);
  }

  function shiftMonth(delta: number) {
    const dt = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(dt.getUTCFullYear());
    setViewMonth(dt.getUTCMonth());
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((prev) => !prev);
          setPickingEnd(false);
        }}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-500"
      >
        <span className="flex items-center gap-1.5 font-mono text-[11px]">
          <span>📅</span>
          {startDate || endDate ? (
            <span>
              {startDate === endDate
                ? startDate
                : `${startDate || '?'} → ${endDate || '?'}`}
            </span>
          ) : (
            <span className="font-sans text-zinc-500">Alege data...</span>
          )}
        </span>
        <span className="text-[10px] text-zinc-500">▾</span>
      </button>

      {open && (
        <div
          className={`absolute z-50 w-72 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-2xl ${
            openUpward ? 'bottom-full mb-1.5' : 'mt-1.5'
          } ${alignRight ? 'right-0' : 'left-0'}`}
        >
          {/* Header Lună */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              ‹
            </button>
            <span className="text-xs font-semibold text-zinc-100">
              {MONTHS_RO[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              ›
            </button>
          </div>

          <p className="mb-2 text-center text-[10px] text-emerald-400">
            {pickingEnd
              ? 'Click pe data de final (Deadline)'
              : 'Click pe data de start'}
          </p>

          {/* Zilele săptămânii */}
          <div className="mb-1 grid grid-cols-7 text-center text-[10px] font-medium text-zinc-500">
            {WEEKDAYS_RO.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>

          {/* Grid Zile */}
          <div className="grid grid-cols-7 gap-0.5 text-center font-mono text-[11px]">
            {calendarCells.map((iso, idx) => {
              if (!iso) return <div key={`empty-${idx}`} />;
              const isStart = iso === startDate;
              const isEnd = iso === endDate;
              const inRange =
                Boolean(startDate && endDate && iso > startDate && iso < endDate);
              const isToday = iso === todayIso;

              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => handleDayClick(iso)}
                  className={`rounded-md py-1.5 transition ${
                    isStart || isEnd
                      ? 'bg-emerald-600 font-bold text-white'
                      : inRange
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : isToday
                          ? 'border border-emerald-500/50 text-emerald-300'
                          : 'text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {Number(iso.slice(8, 10))}
                </button>
              );
            })}
          </div>

          {/* Quick Presets */}
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1 border-t border-zinc-800 pt-2 text-[10px]">
            <button
              type="button"
              onClick={() => applyQuickPreset(0)}
              className="rounded bg-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-700"
            >
              Azi
            </button>
            <button
              type="button"
              onClick={() => applyQuickPreset(1)}
              className="rounded bg-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-700"
            >
              Mâine
            </button>
            <button
              type="button"
              onClick={() => applyQuickPreset(7)}
              className="rounded bg-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-700"
            >
              +7 zile
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(null, null);
                setOpen(false);
              }}
              className="rounded px-2 py-1 text-rose-400 hover:bg-zinc-800"
            >
              Șterge
            </button>
          </div>
        </div>
      )}
    </div>
  );
}