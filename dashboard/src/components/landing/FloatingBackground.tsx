const PARTICLES = [
  { top: "8%", left: "12%", size: 26, dur: 16, delay: 0, dx: 30, dy: -20, opacity: 0.12 },
  { top: "18%", left: "82%", size: 18, dur: 12, delay: 1, dx: -24, dy: 24, opacity: 0.1 },
  { top: "62%", left: "6%", size: 22, dur: 15, delay: 2, dx: 20, dy: 26, opacity: 0.1 },
  { top: "75%", left: "90%", size: 32, dur: 18, delay: 0.5, dx: -30, dy: -18, opacity: 0.1 },
  { top: "40%", left: "94%", size: 14, dur: 10, delay: 3, dx: -16, dy: 20, opacity: 0.14 },
  { top: "88%", left: "40%", size: 20, dur: 13, delay: 1.6, dx: 22, dy: -22, opacity: 0.1 },
  { top: "4%", left: "48%", size: 16, dur: 11, delay: 2.4, dx: -18, dy: 18, opacity: 0.12 },
  { top: "55%", left: "22%", size: 12, dur: 9, delay: 0.8, dx: 14, dy: -16, opacity: 0.1 },
];

function Hexagon({ size }: { size: number }) {
  return (
    <svg width={size} height={size * 1.12} viewBox="0 0 100 112">
      <polygon points="50,4 93,28 93,84 50,108 7,84 7,28" fill="none" stroke="#22c08c" strokeWidth="4" />
    </svg>
  );
}

/** Purely decorative — slow-drifting hexagons (echoing the logo mark) behind
 *  the hero content. CSS-only, respects prefers-reduced-motion via globals.css. */
export function FloatingBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {PARTICLES.map((p, i) => (
        <div
          key={i}
          className="drift absolute"
          style={
            {
              top: p.top,
              left: p.left,
              opacity: p.opacity,
              "--dur": `${p.dur}s`,
              "--dx": `${p.dx}px`,
              "--dy": `${p.dy}px`,
              animationDelay: `${p.delay}s`,
            } as React.CSSProperties
          }
        >
          <Hexagon size={p.size} />
        </div>
      ))}
    </div>
  );
}
