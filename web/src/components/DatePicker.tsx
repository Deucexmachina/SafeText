import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { svgIcon } from "./SiteNav";
import "../datepicker.css";

/* SafeText's own date (and optional time) picker. Replaces the browser's built-in
   calendar pop-up, which can't be styled. Values use the same formats as
   <input type="date"> ("YYYY-MM-DD") and <input type="datetime-local">
   ("YYYY-MM-DDTHH:mm"), so callers don't change how they store dates.

   Keyboard: arrows move by day/week, PageUp/PageDown by month, Home/End to the
   start/end of the week, Enter or Space picks, Esc closes. */

const IconCalendar = () => svgIcon(18, <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>);
const IconPrev = () => svgIcon(18, <path d="m15 6-6 6 6 6" />);
const IconNext = () => svgIcon(18, <path d="m9 6 6 6-6 6" />);

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number) => String(n).padStart(2, "0");
const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function fromKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
function addMonths(d: Date, n: number) {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last));
}

function parseTime(value: string): { h: number; m: number } {
  const t = /T(\d{2}):(\d{2})/.exec(value);
  return t ? { h: Number(t[1]), m: Number(t[2]) } : { h: 23, m: 59 };
}

export function DatePicker({ id, value, onChange, min, max, withTime = false, placeholder = "Select a date", invalid, describedBy }: {
  id: string;
  /** "YYYY-MM-DD", or "YYYY-MM-DDTHH:mm" when withTime; "" for none. */
  value: string;
  onChange: (value: string) => void;
  /** Earliest / latest selectable day, "YYYY-MM-DD". */
  min?: string;
  max?: string;
  withTime?: boolean;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? fromKey(value) : null;
  const time = parseTime(value);
  const minDate = min ? fromKey(min) : null;
  const maxDate = max ? fromKey(max) : null;
  const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const [focus, setFocus] = useState<Date>(selected ?? today);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const disabled = (d: Date) => (minDate !== null && d < minDate) || (maxDate !== null && d > maxDate);
  const clamp = (d: Date) => (minDate && d < minDate ? minDate : maxDate && d > maxDate ? maxDate : d);

  // Opening starts on the chosen day, or today (kept within the allowed range).
  function openPicker() { setFocus(clamp(selected ?? today)); setOpen(true); }
  function close(returnFocus = true) { setOpen(false); if (returnFocus) trigger.current?.focus(); }

  // Close on outside click; move keyboard focus to the active day when it changes.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open) grid.current?.querySelector<HTMLButtonElement>(`[data-day="${toKey(focus)}"]`)?.focus();
  }, [open, focus]);

  function emit(day: Date, h = time.h, m = time.m) {
    onChange(withTime ? `${toKey(day)}T${pad(h)}:${pad(m)}` : toKey(day));
  }
  function pick(day: Date) {
    if (disabled(day)) return;
    emit(day);
    if (!withTime) close();
  }
  function setTime(h: number, m: number) {
    emit(selected ?? clamp(focus), (h + 24) % 24, (m + 60) % 60);
  }

  function onGridKey(e: KeyboardEvent) {
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focus, -1), ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7), ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, -1), PageDown: () => addMonths(focus, 1),
      Home: () => addDays(focus, -focus.getDay()), End: () => addDays(focus, 6 - focus.getDay()),
    };
    if (moves[e.key]) { e.preventDefault(); setFocus(clamp(moves[e.key]())); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(focus); }
  }

  // Calendar cells for the focused month (blank cells pad the first week).
  const first = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const daysInMonth = new Date(focus.getFullYear(), focus.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(first.getFullYear(), first.getMonth(), i + 1))];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const prevMonthEnd = new Date(first.getFullYear(), first.getMonth(), 0);
  const nextMonthStart = new Date(first.getFullYear(), first.getMonth() + 1, 1);
  const canPrev = !minDate || prevMonthEnd >= minDate;
  const canNext = !maxDate || nextMonthStart <= maxDate;

  const label = selected
    ? selected.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
      + (withTime ? `, ${new Date(2000, 0, 1, time.h, time.m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "")
    : placeholder;
  const hour12 = time.h % 12 === 0 ? 12 : time.h % 12;
  const pm = time.h >= 12;

  return (
    <div className="dp" ref={root} onKeyDown={e => { if (e.key === "Escape" && open) { e.stopPropagation(); close(); } }}>
      <button ref={trigger} id={id} type="button" className={`dp-trigger${selected ? "" : " is-empty"}`}
        aria-haspopup="dialog" aria-expanded={open} aria-invalid={invalid || undefined} aria-describedby={describedBy}
        onClick={() => (open ? close() : openPicker())}>
        <span>{label}</span><IconCalendar />
      </button>

      {open && (
        <div className="dp-pop" role="dialog" aria-modal="false" aria-labelledby={titleId}
          onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget) && e.relatedTarget !== trigger.current) setOpen(false); }}>
          <div className="dp-head">
            <button type="button" className="dp-nav" aria-label="Previous month" disabled={!canPrev} onClick={() => setFocus(clamp(addMonths(focus, -1)))}><IconPrev /></button>
            <p id={titleId} className="dp-title" aria-live="polite">{focus.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>
            <button type="button" className="dp-nav" aria-label="Next month" disabled={!canNext} onClick={() => setFocus(clamp(addMonths(focus, 1)))}><IconNext /></button>
          </div>

          <div className="dp-grid" role="grid" aria-labelledby={titleId} ref={grid} onKeyDown={onGridKey}>
            <div className="dp-row" role="row">
              {WEEKDAYS.map((d, i) => <span key={d} className="dp-weekday" role="columnheader" aria-label={WEEKDAY_NAMES[i]}>{d}</span>)}
            </div>
            {weeks.map((week, w) => (
              <div key={w} className="dp-row" role="row">
                {week.map((day, i) => day ? (
                  <span key={i} role="gridcell" aria-selected={selected ? toKey(day) === toKey(selected) : false}>
                    <button type="button" data-day={toKey(day)} className="dp-day"
                      tabIndex={toKey(day) === toKey(focus) ? 0 : -1}
                      disabled={disabled(day)}
                      aria-current={toKey(day) === toKey(today) ? "date" : undefined}
                      aria-label={day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                      onClick={() => { setFocus(day); pick(day); }}>
                      {day.getDate()}
                    </button>
                  </span>
                ) : <span key={i} role="gridcell" className="dp-blank" />)}
              </div>
            ))}
          </div>

          {withTime && (
            <div className="dp-time" role="group" aria-label="Time">
              <span className="dp-time-label">Time</span>
              <div className="dp-stepper">
                <button type="button" aria-label="Earlier hour" onClick={() => setTime(time.h - 1, time.m)}>−</button>
                <span aria-live="polite" aria-label={`Hour ${hour12}`}>{pad(hour12)}</span>
                <button type="button" aria-label="Later hour" onClick={() => setTime(time.h + 1, time.m)}>+</button>
              </div>
              <span className="dp-colon" aria-hidden="true">:</span>
              <div className="dp-stepper">
                <button type="button" aria-label="5 minutes earlier" onClick={() => setTime(time.h, Math.ceil(time.m / 5) * 5 - 5)}>−</button>
                <span aria-live="polite" aria-label={`Minute ${time.m}`}>{pad(time.m)}</span>
                <button type="button" aria-label="5 minutes later" onClick={() => setTime(time.h, Math.floor(time.m / 5) * 5 + 5)}>+</button>
              </div>
              <div className="dp-ampm" role="group" aria-label="AM or PM">
                <button type="button" aria-pressed={!pm} onClick={() => pm && setTime(time.h - 12, time.m)}>AM</button>
                <button type="button" aria-pressed={pm} onClick={() => !pm && setTime(time.h + 12, time.m)}>PM</button>
              </div>
            </div>
          )}

          <div className="dp-foot">
            {value ? <button type="button" className="dp-text-btn" onClick={() => { onChange(""); close(); }}>Clear</button> : <span />}
            <div className="dp-foot-right">
              {!disabled(today) && <button type="button" className="dp-text-btn" onClick={() => { setFocus(today); pick(today); }}>Today</button>}
              {withTime && <button type="button" className="dp-done" onClick={() => close()}>Done</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
