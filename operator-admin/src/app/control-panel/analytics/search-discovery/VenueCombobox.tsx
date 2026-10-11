"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState } from "react";
import { filterVenues, type PickerVenue } from "@/lib/searchDiscoveryReporting/venueSearch";

/**
 * Searchable venue picker (ARIA combobox + listbox). Type part of a name;
 * ↑/↓ move, Enter opens, Escape closes. Each option is a real link to the
 * report with `venue=` set, built from `baseHref` (which carries the other
 * report controls), so selection works by mouse, touch or keyboard.
 */
export default function VenueCombobox({
  venues,
  selected,
  baseHref,
  clearHref,
}: {
  venues: PickerVenue[];
  selected: { id: string; name: string } | null;
  /** Report URL with every current control except `venue`. */
  baseHref: string;
  clearHref: string;
}) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => filterVenues(query, venues, 30), [query, venues]);
  const hrefFor = (id: string) => `${baseHref}${baseHref.includes("?") ? "&" : "?"}venue=${id}`;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const m = matches[active];
      if (open && m) {
        e.preventDefault();
        setOpen(false);
        router.push(hrefFor(m.id));
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const activeCount = venues.filter((v) => v.active).length;

  return (
    <div className="mb-6">
      <label htmlFor={`${listId}-input`} className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
        Venue
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-96">
          <input
            ref={inputRef}
            id={`${listId}-input`}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && matches[active] ? optionId(active) : undefined}
            autoComplete="off"
            placeholder={selected ? `Showing ${selected.name} — type to change` : "Type part of a venue name…"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={onKeyDown}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          {open && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Matching venues"
              className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
            >
              {matches.length === 0 ? (
                <li className="px-3 py-2 text-sm text-gray-400">No venue matches “{query}”</li>
              ) : (
                matches.map((v, i) => (
                  <li key={v.id} id={optionId(i)} role="option" aria-selected={i === active}>
                    <Link
                      href={hrefFor(v.id)}
                      tabIndex={-1}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setOpen(false)}
                      onMouseEnter={() => setActive(i)}
                      className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${i === active ? "bg-slate-100" : ""}`}
                    >
                      <span className="truncate text-gray-800">{v.name}</span>
                      {v.active && <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">activity</span>}
                    </Link>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        {selected && (
          <Link href={clearHref} className="text-xs text-gray-500 hover:text-gray-700">
            Clear venue ✕
          </Link>
        )}
      </div>
      <p className="mt-1 text-[11px] text-gray-400">
        {venues.length} published venues · {activeCount} with discovery activity in this range (marked “activity”, listed first).
      </p>
    </div>
  );
}
