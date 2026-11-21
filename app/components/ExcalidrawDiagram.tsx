'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Excalidraw,
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

type ExcalidrawProps = React.ComponentProps<typeof Excalidraw>;
type InitialSceneData = ExcalidrawProps['initialData'];
type ExcalidrawAPI = Parameters<NonNullable<ExcalidrawProps['excalidrawAPI']>>[0];
type SceneElements = Parameters<NonNullable<ExcalidrawProps['onChange']>>[0];

function hashChart(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function ExcalidrawDiagram({ chart }: { chart: string }) {
  const storageKey = useMemo(() => `alumn-excalidraw-${hashChart(chart.trim())}`, [chart]);

  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawAPI | null>(null);
  const [sceneData, setSceneData] = useState<InitialSceneData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [hasLocalEdits, setHasLocalEdits] = useState(false);
  const [sceneKey, setSceneKey] = useState(0);

  const lastSavedSignatureRef = useRef<string>('');
  const isInitialLoadRef = useRef<boolean>(true);

  async function buildFromMermaid() {
    const { parseMermaidToExcalidraw } = await import('@excalidraw/mermaid-to-excalidraw');
    const { elements, files } = await parseMermaidToExcalidraw(chart.trim(), {
      themeVariables: {
        fontSize: '16px',
      },
    });
    const converted = convertToExcalidrawElements(elements);
    return {
      elements: converted,
      files: files || {},
      appState: {
        theme: 'dark' as const,
        viewBackgroundColor: '#09090b',
      },
    };
  }

  useEffect(() => {
    let active = true;
    isInitialLoadRef.current = true;

    async function initScene() {
      try {
        setError(null);
        const savedRaw = localStorage.getItem(storageKey);
        if (savedRaw) {
          const parsed = JSON.parse(savedRaw);
          if (active && Array.isArray(parsed.elements)) {
            lastSavedSignatureRef.current = JSON.stringify(
              parsed.elements.map((el: { id: string; version?: number }) => `${el.id}:${el.version}`)
            );
            setSceneData({
              elements: parsed.elements,
              files: parsed.files || {},
              appState: {
                theme: 'dark',
                viewBackgroundColor: '#09090b',
              },
            });
            setHasLocalEdits(true);
            return;
          }
        }

        const fresh = await buildFromMermaid();
        if (active) {
          lastSavedSignatureRef.current = JSON.stringify(
            fresh.elements.map((el) => `${el.id}:${el.version}`)
          );
          setSceneData(fresh);
          setHasLocalEdits(false);
        }
      } catch (err: unknown) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : 'Nu am putut converti diagrama Mermaid în Excalidraw.'
          );
        }
      }
    }

    initScene();
    return () => {
      active = false;
    };
  }, [chart, storageKey]);

  // Centrare automată după ce se montează canvas-ul
  useEffect(() => {
    if (!excalidrawAPI || !sceneData) return;
    const timer = setTimeout(() => {
      excalidrawAPI.scrollToContent(undefined, { fitToContent: true });
    }, 120);
    return () => clearTimeout(timer);
  }, [excalidrawAPI, sceneData, isFullscreen]);

  function handleSceneChange(elements: SceneElements) {
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      return;
    }

    const signature = JSON.stringify(elements.map((el) => `${el.id}:${el.version}`));
    if (signature === lastSavedSignatureRef.current) return;

    lastSavedSignatureRef.current = signature;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          elements,
          files: excalidrawAPI?.getFiles() || {},
        })
      );
      setHasLocalEdits(true);
    } catch {
      // Ignorăm dacă localStorage este plin
    }
  }

  async function resetLocalEdits() {
    localStorage.removeItem(storageKey);
    const fresh = await buildFromMermaid();
    lastSavedSignatureRef.current = JSON.stringify(
      fresh.elements.map((el) => `${el.id}:${el.version}`)
    );
    setSceneData(fresh);
    setHasLocalEdits(false);
    setSceneKey((k) => k + 1);
  }

  async function handleExportPng() {
    if (!excalidrawAPI) return;
    const blob = await exportToBlob({
      elements: excalidrawAPI.getSceneElements(),
      appState: { ...excalidrawAPI.getAppState(), exportWithDarkMode: true },
      files: excalidrawAPI.getFiles(),
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schema-alumni-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportSvg() {
    if (!excalidrawAPI) return;
    const svg = await exportToSvg({
      elements: excalidrawAPI.getSceneElements(),
      appState: { ...excalidrawAPI.getAppState(), exportWithDarkMode: true },
      files: excalidrawAPI.getFiles(),
    });
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schema-alumni-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) {
    return (
      <div className="my-3 rounded-xl border border-amber-500/30 bg-zinc-950 p-3 text-xs">
        <p className="mb-2 font-medium text-amber-400">
          ⚠️ Eroare conversie Excalidraw ({error}). Cod Mermaid generat:
        </p>
        <pre className="overflow-x-auto font-mono text-[11px] text-zinc-300">{chart}</pre>
      </div>
    );
  }

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-4 z-50 flex flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl'
          : 'my-3 overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-950'
      }
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/90 px-3 py-1.5 text-[11px] text-zinc-400">
        <div className="flex items-center gap-2">
          <span className="font-mono uppercase tracking-wider text-emerald-400">
            ✏️ Excalidraw
          </span>
          {hasLocalEdits && (
            <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300">
              Editat local
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {hasLocalEdits && (
            <button
              type="button"
              onClick={resetLocalEdits}
              title="Revino la diagrama generată inițial de AI"
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-300 hover:border-amber-500/50 hover:text-amber-300"
            >
              ↺ Resetează
            </button>
          )}
          <button
            type="button"
            onClick={handleExportPng}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-200 hover:border-emerald-500/50"
          >
            PNG
          </button>
          <button
            type="button"
            onClick={handleExportSvg}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-200 hover:border-emerald-500/50"
          >
            SVG
          </button>
          <button
            type="button"
            onClick={() => setShowCode((prev) => !prev)}
            className="rounded px-2 py-0.5 hover:bg-zinc-800 hover:text-zinc-200"
          >
            {showCode ? 'Tabla' : 'Mermaid'}
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-zinc-200 hover:border-sky-500/50"
          >
            {isFullscreen ? '✕ Închide Fullscreen' : '⛶ Fullscreen'}
          </button>
        </div>
      </div>

      {/* Canvas Excalidraw sau cod Mermaid */}
      {showCode ? (
        <pre className="overflow-x-auto p-4 font-mono text-xs text-zinc-300">{chart}</pre>
      ) : !sceneData ? (
        <div className="flex h-[320px] items-center justify-center text-xs text-zinc-400 animate-pulse">
          Generez tabla Excalidraw...
        </div>
      ) : (
        <div className={isFullscreen ? 'flex-1 w-full' : 'h-[460px] w-full'}>
          <Excalidraw
            key={sceneKey}
            excalidrawAPI={(api) => setExcalidrawAPI(api)}
            initialData={sceneData}
            onChange={(elements) => handleSceneChange(elements)}
            theme="dark"
            UIOptions={{
              canvasActions: {
                loadScene: false,
                saveToActiveFile: false,
              },
            }}
          />
        </div>
      )}
    </div>
  );
}