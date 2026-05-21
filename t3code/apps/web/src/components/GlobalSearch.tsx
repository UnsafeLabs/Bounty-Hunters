import React, { useState, useEffect, useRef } from "react";
import { SearchIcon } from "lucide-react";
export function GlobalSearch({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; source: string; title: string; preview: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (isOpen && inputRef.current) inputRef.current.focus(); }, [isOpen]);
  useEffect(() => { const t = setTimeout(() => { if (query.trim()) setResults([{ id: "1", source: "chat", title: "Chat", preview: "..." + query }, { id: "2", source: "files", title: "Files", preview: "..." + query }]); else setResults([]); }, 300); return () => clearTimeout(t); }, [query]);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape" && isOpen) onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [isOpen, onClose]);
  if (!isOpen) return null;
  return React.createElement("div", { className: "fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/50" },
    React.createElement("div", { className: "w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-gray-900 p-4" },
      React.createElement("input", { ref: inputRef, value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Search...", className: "w-full border-0 bg-transparent px-3 py-2 text-sm outline-none" }),
      results.length > 0 && React.createElement("div", { className: "mt-2 space-y-1" }, results.map((r) => React.createElement("div", { key: r.id, className: "flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded cursor-pointer" }, React.createElement("div", { className: "text-sm font-medium" }, r.title))))));}