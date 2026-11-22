'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';

interface CrmExcelImportModalProps {
  onClose: () => void;
  onImported: () => void;
}

export function CrmExcelImportModal({ onClose, onImported }: CrmExcelImportModalProps) {
  const [sourceMode, setSourceMode] = useState<'gsheet' | 'file'>('gsheet');
  const [sheetUrl, setSheetUrl] = useState('');
  const [targetTable, setTargetTable] = useState<'people' | 'resources' | 'events' | 'partners'>('people');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [workbookRef, setWorkbookRef] = useState<XLSX.WorkBook | null>(null);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const wb = XLSX.read(data, { type: 'array' });
        setWorkbookRef(wb);
        setSheetNames(wb.SheetNames);
        const firstSheet = wb.SheetNames[0];
        setSelectedSheet(firstSheet);
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet], {
          defval: '',
        });
        setPreviewRows(json);
      } catch {
        setError('Nu am putut citi fișierul Excel. Verifică formatul (.xlsx, .xls, .csv).');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleSheetSwitch(sheetName: string) {
    setSelectedSheet(sheetName);
    if (!workbookRef) return;
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbookRef.Sheets[sheetName], {
      defval: '',
    });
    setPreviewRows(json);
  }

  async function runGoogleSheetSync() {
    if (!sheetUrl.trim() || importing) return;
    setImporting(true);
    setError(null);
    try {
      const res = await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import_google_sheet',
          sheetUrl: sheetUrl.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare la sincronizarea Google Sheets.');
      onImported();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Eroare la sincronizare.');
    } finally {
      setImporting(false);
    }
  }

  async function runFileImport() {
    if (previewRows.length === 0 || importing) return;
    setImporting(true);
    setError(null);
    try {
      const res = await fetch('/api/pmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import_excel',
          targetTable,
          rows: previewRows,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare la import.');
      onImported();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Eroare la salvarea în baza de date.');
    } finally {
      setImporting(false);
    }
  }

  const columns = previewRows.length > 0 ? Object.keys(previewRows[0]).slice(0, 6) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              📥 Sincronizare Bază de Date Alumni (Google Sheets / Excel)
            </h3>
            <p className="text-xs text-zinc-400">
              Mapează automat coloanele din Google Forms (Nume, Email, Telefon, Departament, Locație, Novice/Veteran).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        {/* Comutator Sursă */}
        <div className="mt-3 flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => {
              setSourceMode('gsheet');
              setError(null);
            }}
            className={`rounded-lg border px-3 py-1.5 font-medium transition ${
              sourceMode === 'gsheet'
                ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                : 'border-zinc-700 bg-zinc-950 text-zinc-400'
            }`}
          >
            🔗 Direct din Link Google Sheets
          </button>
          <button
            type="button"
            onClick={() => {
              setSourceMode('file');
              setError(null);
            }}
            className={`rounded-lg border px-3 py-1.5 font-medium transition ${
              sourceMode === 'file'
                ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                : 'border-zinc-700 bg-zinc-950 text-zinc-400'
            }`}
          >
            📁 Încarcă fișier (.xlsx / .csv)
          </button>
        </div>

        {sourceMode === 'gsheet' ? (
          <div className="mt-4 space-y-3 text-xs">
            <div>
              <label className="mb-1 block font-medium text-zinc-300">
                Link-ul Google Sheet-ului (Share → Anyone with the link → Viewer)
              </label>
              <input
                type="url"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            {error && <p className="text-rose-400">⚠️ {error}</p>}

            <div className="flex justify-end gap-2 border-t border-zinc-800 pt-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800"
              >
                Anulează
              </button>
              <button
                type="button"
                disabled={!sheetUrl.trim() || importing}
                onClick={runGoogleSheetSync}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                {importing ? 'Sincronizez...' : 'Sincronizează acum'}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4 text-xs">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block font-medium text-zinc-300">1. Tabel destinație</label>
                <select
                  value={targetTable}
                  onChange={(e) =>
                    setTargetTable(e.target.value as 'people' | 'resources' | 'events' | 'partners')
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-200 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="people">Oameni (Alumni & Board)</option>
                  <option value="resources">Resurse</option>
                  <option value="events">Evenimente</option>
                  <option value="partners">Parteneri</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block font-medium text-zinc-300">2. Încarcă fișierul</label>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-zinc-300 file:mr-2 file:rounded file:border-0 file:bg-emerald-600 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-white"
                />
              </div>
            </div>

            {sheetNames.length > 1 && (
              <div>
                <label className="mb-1 block font-medium text-zinc-300">Selectează Sheet-ul</label>
                <select
                  value={selectedSheet}
                  onChange={(e) => handleSheetSwitch(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-zinc-200"
                >
                  {sheetNames.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {previewRows.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-medium text-emerald-400">
                  ✓ {previewRows.length} rânduri detectate (preview primele 4):
                </p>
                <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950">
                  <table className="w-full text-left text-[11px]">
                    <thead className="border-b border-zinc-800 bg-zinc-900 text-zinc-400">
                      <tr>
                        {columns.map((col) => (
                          <th key={col} className="px-2.5 py-1.5 font-medium">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/70 text-zinc-300">
                      {previewRows.slice(0, 4).map((row, idx) => (
                        <tr key={idx}>
                          {columns.map((col) => (
                            <td key={col} className="max-w-[160px] truncate px-2.5 py-1.5">
                              {String(row[col] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {error && <p className="text-rose-400">⚠️ {error}</p>}

            <div className="flex justify-end gap-2 border-t border-zinc-800 pt-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800"
              >
                Anulează
              </button>
              <button
                type="button"
                disabled={previewRows.length === 0 || importing}
                onClick={runFileImport}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                {importing ? 'Import...' : `Importă ${previewRows.length} rânduri`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}