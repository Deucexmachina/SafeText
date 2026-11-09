import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

export function NavigationMenu({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return <div className="navigation-menu" ref={container} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={toggle} type="button" className="navigation-toggle" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="navigation-links" onClick={() => setOpen(value => !value)}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        {open ? <path d="m6 6 12 12M6 18 18 6" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
      </svg>
    </button>
    <nav id="navigation-links" className="navigation-links" aria-label="Main navigation" hidden={!open}>
      <NavLink to="/" end onClick={() => setOpen(false)} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Scan</NavLink>
      <NavLink to="/history" onClick={() => setOpen(false)} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>History</NavLink>
      {isAdmin && <NavLink to="/admin" onClick={() => setOpen(false)} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>Admin</NavLink>}
    </nav>
  </div>;
}
