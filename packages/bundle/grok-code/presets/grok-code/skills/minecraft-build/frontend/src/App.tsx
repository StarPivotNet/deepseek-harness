import { useCallback, useEffect, useRef, useState } from "react";
import { MinecraftViewer } from "@/components/MinecraftViewer";
import { ViewerToolbar } from "@/components/ViewerToolbar";
import { useStore } from "@/store";

const LOCAL_KEY = "minecraft-build:structure";

function isStructure(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const blocks = (value as { blocks?: unknown }).blocks;
  return Array.isArray(blocks);
}

function structureFromText(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (isStructure(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const nested = (parsed as { structure?: unknown }).structure;
    if (isStructure(nested)) return nested;
  }
  throw new Error("This JSON has no blocks array.");
}

function nameFromPath(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash === -1 ? path : path.slice(slash + 1);
}

// A raw disk path is not a URL the browser can fetch. Vite serves an absolute
// path only under /@fs/. A Windows drive letter matches a scheme pattern, so
// only scheme:// is left untouched; C:/... must still be rewritten.
function structureUrl(file: string): string {
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(file)) return file;
  const absolute = file.replace(/\\/g, "/");
  if (absolute.startsWith("/")) return `/@fs${absolute}`;
  return `/@fs/${absolute}`;
}

export function App() {
  const structure = useStore((s) => s.structure);
  const structureName = useStore((s) => s.structureName);
  const loadError = useStore((s) => s.loadError);
  const setStructure = useStore((s) => s.setStructure);
  const setLoadError = useStore((s) => s.setLoadError);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = useCallback(
    (text: string, name: string, remember: boolean) => {
      try {
        const next = structureFromText(text);
        setStructure(next, name);
        if (remember) {
          localStorage.setItem(LOCAL_KEY, JSON.stringify({ name, text }));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not read that file.";
        setLoadError(message);
      }
    },
    [setLoadError, setStructure]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const file = params.get("file");
    if (file) {
      let cancelled = false;
      fetch(structureUrl(file))
        .then((response) => {
          if (!response.ok) throw new Error(`Could not open ${file} (${response.status}).`);
          return response.text();
        })
        .then((text) => {
          if (!cancelled) accept(text, nameFromPath(file), true);
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            const message = err instanceof Error ? err.message : "Could not open that file.";
            setLoadError(message);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    const saved = localStorage.getItem(LOCAL_KEY);
    if (!saved) return;
    try {
      const stored = JSON.parse(saved) as { name?: unknown; text?: unknown };
      if (typeof stored.text === "string") {
        accept(stored.text, typeof stored.name === "string" ? stored.name : "structure.json", false);
      }
    } catch {
      localStorage.removeItem(LOCAL_KEY);
    }
  }, [accept, setLoadError]);

  const readFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") accept(reader.result, file.name, true);
      };
      reader.onerror = () => setLoadError("Could not read that file.");
      reader.readAsText(file);
    },
    [accept, setLoadError]
  );

  const blockCount = Array.isArray(structure?.blocks) ? structure.blocks.length : 0;
  const size = structure
    ? `${structure.width} × ${structure.height} × ${structure.depth}`
    : "";

  return (
    <div
      className="h-screen w-screen relative overflow-hidden bg-zinc-900 text-white"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) readFile(file);
      }}
    >
      {structure ? (
        <MinecraftViewer />
      ) : (
        <div className="h-full flex items-center justify-center px-6">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-semibold">Structure preview</h1>
            <p className="mt-3 text-sm text-white/70 leading-relaxed">
              Drop a structure JSON here, or open this page with{" "}
              <span className="font-mono text-white/90">?file=</span> pointing at one.
              The file needs a <span className="font-mono text-white/90">blocks</span> array.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-6 rounded-md bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Open a structure
            </button>
            {loadError && <p className="mt-4 text-sm text-red-300">{loadError}</p>}
          </div>
        </div>
      )}

      {dragging && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 text-lg">
          Drop the structure JSON
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) readFile(file);
          event.target.value = "";
        }}
      />

      {structure && (
        <>
          <div className="absolute top-4 left-4 z-20 flex items-center gap-3 rounded-md bg-black/50 px-3 py-2 text-sm backdrop-blur-xl">
            <span className="max-w-64 truncate">{structureName}</span>
            <span className="text-white/60">{size}</span>
            <span className="text-white/60">{blockCount} blocks</span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded px-2 py-1 text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              Open another
            </button>
          </div>
          <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
            <ViewerToolbar />
          </div>
        </>
      )}
    </div>
  );
}
