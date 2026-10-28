import { useEffect, useRef, useState } from "react";

/**
 * Element picker limited to the playground: hover to highlight, ↑ for the
 * bigger container, ↓ to go back, click or Enter to pick, Esc to cancel.
 * On touch screens a tap picks directly.
 */
export function usePicker(containerRef, active, { onPick, onCancel }) {
  const [box, setBox] = useState(null);
  const current = useRef(null);
  const trail = useRef([]);

  useEffect(() => {
    if (!active) {
      setBox(null);
      current.current = null;
      return undefined;
    }
    const root = containerRef.current;
    if (!root) return undefined;

    const describe = (el) => {
      const r = el.getBoundingClientRect();
      const d = globalThis.RiffExtract.describe(el);
      setBox({ left: r.left, top: r.top, width: r.width, height: r.height, label: `${d.selector} · ${Math.round(r.width)}×${Math.round(r.height)}` });
    };
    const select = (el) => {
      if (!el || !root.contains(el) || el === root) return;
      current.current = el;
      describe(el);
    };
    const inside = (el) => el instanceof Element && root.contains(el) && el !== root;

    const onMove = (event) => {
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (inside(el) && el !== current.current) {
        trail.current = [];
        select(el);
      }
    };
    const onClick = (event) => {
      if (!inside(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      onPick(current.current && root.contains(current.current) ? current.current : event.target);
    };
    const onPointerDown = (event) => {
      if (event.pointerType === "touch" && inside(event.target)) select(event.target);
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      } else if (event.key === "Enter" && current.current) {
        event.preventDefault();
        onPick(current.current);
      } else if (event.key === "ArrowUp" && current.current) {
        const parent = current.current.parentElement;
        if (parent && parent !== root && root.contains(parent)) {
          event.preventDefault();
          trail.current.push(current.current);
          select(parent);
        }
      } else if (event.key === "ArrowDown" && current.current) {
        event.preventDefault();
        select(trail.current.pop() || current.current.firstElementChild || current.current);
      }
    };
    const onScroll = () => current.current && describe(current.current);

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [active, containerRef, onPick, onCancel]);

  return box;
}
