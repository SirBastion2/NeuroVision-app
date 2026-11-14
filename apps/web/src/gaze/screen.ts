/**
 * Page (client) ↔ physical screen coordinates. Calibration targets are stored in SCREEN
 * coordinates so the mapping stays valid when the browser enters or leaves fullscreen;
 * output is converted back to page coordinates at the moment it is emitted.
 *
 * Browser chrome is estimated from outer/inner window sizes: side borders split evenly,
 * the rest of the height difference is toolbars at the top.
 */

export interface WindowMetrics {
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
  innerWidth: number;
  innerHeight: number;
}

export function readWindowMetrics(): WindowMetrics {
  return {
    screenX: window.screenX,
    screenY: window.screenY,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  };
}

/** Screen position of the page's (0, 0). */
export function pageOrigin(m: WindowMetrics): { x: number; y: number } {
  const side = Math.max(0, (m.outerWidth - m.innerWidth) / 2);
  const top = Math.max(0, m.outerHeight - m.innerHeight - side);
  return { x: m.screenX + side, y: m.screenY + top };
}

export function pageToScreen(p: { x: number; y: number }, m: WindowMetrics): { x: number; y: number } {
  const o = pageOrigin(m);
  return { x: p.x + o.x, y: p.y + o.y };
}

export function screenToPage(p: { x: number; y: number }, m: WindowMetrics): { x: number; y: number } {
  const o = pageOrigin(m);
  return { x: p.x - o.x, y: p.y - o.y };
}
