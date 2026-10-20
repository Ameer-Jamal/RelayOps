import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { TeamsDirectoryEntry, TeamsDirectoryView } from "@relayops/shared/adminApi";
import { apiRequest } from "../api/client";

type Kind = "all" | "person" | "chat" | "channel";
export function destinationLabel(entry: TeamsDirectoryEntry): string {
  return entry.teamName ? `${entry.teamName} / ${entry.displayName}` : entry.displayName;
}
function destinationType(entry: TeamsDirectoryEntry): string {
  return entry.kind === "channel" ? "Channel" : entry.chatType === "oneOnOne" ? "Person" :
    entry.chatType === "self" ? "Self-chat" : entry.chatType === "meeting" ? "Meeting" : entry.chatType === "bot" ? "Bot" : "Chat";
}

export function DestinationPicker({ value, onChange, disabled = false, revision = 0 }: {
  value: TeamsDirectoryEntry | null;
  onChange: (entry: TeamsDirectoryEntry) => void;
  disabled?: boolean;
  revision?: number;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [listHeight, setListHeight] = useState(320);
  const [side, setSide] = useState("bottom");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [page, setPage] = useState<TeamsDirectoryView | null>(null);
  const [offset, setOffset] = useState(0);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ query, kind, limit: "30", offset: String(offset) });
      void apiRequest<TeamsDirectoryView>(`/api/teams/directory?${params}`, { signal: controller.signal })
        .then((result) => { if (!controller.signal.aborted) { setPage(result); setActive(0); } })
        .catch((caught: unknown) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught)); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, query, kind, offset, revision]);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      if (!root.current || !popup.current || !list.current) return;
      const rect = root.current.getBoundingClientRect();
      const above = rect.top;
      const below = window.innerHeight - rect.bottom;
      const useAbove = below < 240 && above > below;
      const overhead = popup.current.offsetHeight - list.current.offsetHeight;
      setSide(useAbove ? "top" : "bottom");
      setListHeight(Math.min(320, Math.max(80, (useAbove ? above : below) - overhead - 24)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(() => {
    if (open) root.current?.querySelector(`#${CSS.escape(`${id}-option-${active}`)}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id, open, page]);

  function select(entry: TeamsDirectoryEntry) { onChange(entry); setOpen(false); trigger.current?.focus(); }
  function changePage(nextOffset: number) {
    // Disabling a focused pagination button can blur it to the document on Chromium.
    // Move focus within the popup before loading so the picker stays open.
    input.current?.focus();
    setOffset(nextOffset);
  }
  function search(nextQuery: string, nextKind = kind) {
    setQuery(nextQuery); setKind(nextKind); setOffset(0); setPage(null); setActive(0); setLoading(true);
  }
  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    const entries = page?.entries ?? [];
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, Math.min(entries.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" && !loading && entries[active]) { event.preventDefault(); select(entries[active]); }
    else if (event.key === "Home" && event.altKey) { event.preventDefault(); setActive(0); }
    else if (event.key === "End" && event.altKey) { event.preventDefault(); setActive(Math.max(0, entries.length - 1)); }
  }
  const options = page?.entries ?? [];
  return (
    <div className="destination-picker" ref={root} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <label className="field-label" htmlFor={`${id}-trigger`}>Teams destination</label>
      <button id={`${id}-trigger`} ref={trigger} type="button" className="destination-trigger"
        aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-popup`} disabled={disabled}
        onClick={() => { setOpen(!open); setQuery(""); setOffset(0); setPage(null); setLoading(true); }}>
        <span>{value ? destinationLabel(value) : "Choose a person, chat, or channel…"}</span><span aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div ref={popup} data-side={side} id={`${id}-popup`} role="dialog" aria-label="Choose a Teams destination" className="destination-popup">
          <div className="destination-search-row">
            <input ref={input} role="combobox" aria-label="Search Teams destinations" placeholder="Search name, email, team, or ID…"
              aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-options`}
              aria-activedescendant={!loading && options.length ? `${id}-option-${active}` : undefined}
              value={query} onChange={(event) => search(event.target.value)} onKeyDown={navigate} />
            <select aria-label="Filter destination type" value={kind} onChange={(event) => search(query, event.target.value as Kind)}>
              <option value="all">All types</option><option value="person">People</option><option value="chat">Chats</option><option value="channel">Channels</option>
            </select>
          </div>
          <p className="destination-count" role="status" aria-live="polite">{loading ? "Searching…" : error ? error : `${page?.matched ?? 0} matching destinations`}</p>
          <ul ref={list} style={{ maxHeight: listHeight }} id={`${id}-options`} role="listbox" aria-label="Teams destinations" aria-busy={loading} className="destination-options">
            {!loading && !error ? options.map((entry, index) => (
              <li id={`${id}-option-${index}`} key={entry.id} role="option" aria-selected={active === index}
                className={`destination-option${active === index ? " destination-option--active" : ""}`}
                onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => select(entry)}>
                <span><strong>{destinationLabel(entry)}</strong><small>{entry.memberEmails.join(", ") || entry.id}</small></span>
                <span className="destination-type">{destinationType(entry)}</span>
              </li>
            )) : null}
          </ul>
          {!loading && !error && !options.length ? <p className="muted destination-empty">No matches. Try a different name or type.</p> : null}
          <div className="destination-pagination">
            <button className="button button--ghost" type="button" disabled={loading || offset === 0} onClick={() => changePage(Math.max(0, offset - 30))}>Previous</button>
            <span>{page?.matched ? `${offset + 1}–${offset + options.length} of ${page.matched}` : "0 results"}</span>
            <button className="button button--ghost" type="button" disabled={loading || page?.nextOffset == null} onClick={() => changePage(page!.nextOffset!)}>Next</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
