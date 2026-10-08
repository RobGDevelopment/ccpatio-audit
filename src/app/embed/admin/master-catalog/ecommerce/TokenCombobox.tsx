"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

export type TokenOption = { code: string; label: string };

function sanitizeToken(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

/**
 * Dictionary combobox for the third-party SKU token.
 * Options show `CODE : meaning`. A typed code that is not in the list can be
 * committed; the parent stores that code as its own label until someone renames it.
 */
export function TokenCombobox({
  value,
  tokens,
  onChange,
  onCommitCustom,
}: {
  value: string;
  tokens: TokenOption[];
  onChange: (code: string) => void;
  onCommitCustom: (code: string) => void;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const query = sanitizeToken(value);
  const matches = useMemo(() => {
    if (!query) return tokens;
    return tokens.filter(
      (token) =>
        token.code.includes(query) || token.label.toUpperCase().includes(query),
    );
  }, [tokens, query]);

  const exact = tokens.some((token) => token.code === query);
  const canAdd = query.length > 0 && !exact;
  const rows = canAdd ? matches.length + 1 : matches.length;

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, []);

  function choose(code: string, custom: boolean) {
    onChange(code);
    setOpen(false);
    if (custom) onCommitCustom(code);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (rows === 0 ? 0 : (index + 1) % rows));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (rows === 0 ? 0 : (index - 1 + rows) % rows));
    } else if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "Enter" && open && rows > 0) {
      event.preventDefault();
      if (canAdd && active === matches.length) choose(query, true);
      else if (matches[active]) choose(matches[active].code, false);
    }
  }

  return (
    <div ref={rootRef} className="relative mt-1.5">
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        type="text"
        value={value}
        onChange={(event) => {
          onChange(sanitizeToken(event.target.value));
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (canAdd) onCommitCustom(query);
        }}
        className="w-full p-2 bg-white border border-amber-200 rounded-lg text-sm"
      />
      {open && rows > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {matches.map((token, index) => (
            <li key={token.code} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(token.code, false)}
                className={`flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm ${
                  index === active ? "bg-sky-50 text-sky-800" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="font-mono font-semibold">{token.code}</span>
                <span className="text-slate-400">:</span>
                <span>{token.label}</span>
              </button>
            </li>
          ))}
          {canAdd && (
            <li role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={active === matches.length}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(query, true)}
                className={`w-full px-3 py-2 text-left text-sm ${
                  active === matches.length ? "bg-amber-50 text-amber-800" : "text-amber-700 hover:bg-amber-50"
                }`}
              >
                Add {query} : {query}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
