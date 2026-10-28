// Shared motion vocabulary (Family Values): one easing signature, a tray that
// overlays instead of replacing, text that morphs instead of snapping.
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

export const EASE_OUT = [0.25, 1, 0.5, 1]; // directional moves, tab slides
export const EASE_TEXT = [0.16, 1, 0.3, 1]; // label morphs
export const SPRING = { type: "spring", stiffness: 420, damping: 36, mass: 0.9 }; // trays, cards

/**
 * "Save idea" → "Saving…" → "Saved": the old label slides up and out while
 * the new one slides in from below, so the change is noticed, not missed.
 */
export function MorphText({ text }) {
  const reduce = useReducedMotion();
  return (
    <span className="morph">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          className="morph-label"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: "0.6em" }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: "-0.6em" }}
          transition={{ duration: 0.22, ease: EASE_TEXT }}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function IconClose() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconBack() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A tray rises over the page instead of replacing it, so you never lose the
 * thing you were looking at. Every tray has a title and a close (or back)
 * button; its height follows its one job, so each step looks different.
 */
export function Tray({ open, title, onClose, onBack, children, labelId, initialFocus }) {
  const reduce = useReducedMotion();
  const panel = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        (onBack || onClose)();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, onBack]);

  useEffect(() => {
    if (!open) return;
    const target = initialFocus?.current || panel.current;
    requestAnimationFrame(() => target?.focus({ preventScroll: true }));
  }, [open, initialFocus, title]);

  return (
    <AnimatePresence>
      {open && (
        <motion.section
          key="tray"
          ref={panel}
          className="tray"
          role="dialog"
          aria-modal="false"
          aria-labelledby={labelId}
          tabIndex={-1}
          layout={!reduce}
          initial={reduce ? { opacity: 0 } : { y: "110%" }}
          animate={reduce ? { opacity: 1 } : { y: 0 }}
          exit={reduce ? { opacity: 0 } : { y: "110%", transition: { duration: 0.2, ease: [0.5, 0, 0.75, 0] } }}
          transition={SPRING}
        >
          <header className="tray-head">
            <button className="icon-btn" type="button" onClick={onBack || onClose} aria-label={onBack ? "Back" : "Close"}>
              {onBack ? <IconBack /> : <IconClose />}
            </button>
            <h2 id={labelId} className="tray-title">
              {title}
            </h2>
          </header>
          {children}
        </motion.section>
      )}
    </AnimatePresence>
  );
}

/** Tabs whose content slides in the direction you moved, so places stay put in your head. */
export function SlidingTabs({ tabs, value, onChange, label }) {
  const index = tabs.findIndex((t) => t.id === value);
  const onKeyDown = (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={tab.id === value}
          aria-controls={`panel-${tab.id}`}
          tabIndex={tab.id === value ? 0 : -1}
          className="tab"
          onClick={() => onChange(tab.id)}
          onKeyDown={onKeyDown}
        >
          {tab.label}
          {tab.id === value && <motion.span layoutId={`tab-underline-${label}`} className="tab-underline" transition={SPRING} />}
        </button>
      ))}
    </div>
  );
}

/** Content for SlidingTabs: enters from the side you moved toward. */
export function TabPanel({ id, direction, children }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={id}
      id={`panel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      className="tabpanel"
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 * direction }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24 * direction }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}
