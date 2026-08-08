const NAVY = "#14304D";
const TEAL = "#22c08c";
const AMBER = "#e8a33d";

function Token({ pathId, delay }: { pathId: string; delay: number }) {
  return (
    <circle r="6" fill={TEAL}>
      <animateMotion dur="3.6s" begin={`${delay}s`} repeatCount="indefinite" rotate="auto">
        <mpath href={`#${pathId}`} />
      </animateMotion>
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.85;1" dur="3.6s" begin={`${delay}s`} repeatCount="indefinite" />
    </circle>
  );
}

/** The core product mechanic, animated: USDC flows from buyer into escrow,
 *  a verifier grades the work, and only then does it flow on to the worker.
 *  Pure SVG + SMIL — no JS animation loop, no extra dependencies. */
export function FlowAnimation() {
  return (
    <svg viewBox="0 0 700 300" className="w-full max-w-3xl mx-auto" role="img" aria-label="Animated diagram: USDC flows from buyer into escrow, a verifier grades the work, then funds release to the worker.">
      <title>How ClearPact settles a job</title>

      <path id="buyer-escrow" d="M 130 210 L 330 210" fill="none" stroke="none" />
      <path id="escrow-worker" d="M 370 210 L 570 210" fill="none" stroke="none" />

      {/* connector lines */}
      <line x1="130" y1="210" x2="330" y2="210" stroke="#23364f" strokeWidth="2" />
      <line x1="370" y1="210" x2="570" y2="210" stroke="#23364f" strokeWidth="2" />
      <line x1="350" y1="150" x2="350" y2="185" stroke="#23364f" strokeWidth="2" strokeDasharray="4 4" />

      {/* flowing tokens: buyer -> escrow */}
      <Token pathId="buyer-escrow" delay={0} />
      <Token pathId="buyer-escrow" delay={1.2} />
      <Token pathId="buyer-escrow" delay={2.4} />

      {/* flowing tokens: escrow -> worker, offset so it reads as "after verification" */}
      <Token pathId="escrow-worker" delay={0.9} />
      <Token pathId="escrow-worker" delay={2.1} />
      <Token pathId="escrow-worker" delay={3.3} />

      {/* Verifier node */}
      <g transform="translate(350,110)">
        <circle r="34" fill={NAVY} />
        <g className="check-pop" style={{ transformOrigin: "0px 0px" }}>
          <path d="M -12 0 L -3 10 L 14 -12" fill="none" stroke={AMBER} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <text x="0" y="-46" textAnchor="middle" className="t" fill="#e7edf5" fontSize="13" fontWeight="500">Verifier</text>
        <text x="0" y="52" textAnchor="middle" className="ts" fill="#8ea3bd" fontSize="11">grades the work</text>
      </g>

      {/* Buyer node */}
      <g transform="translate(100,210)">
        <circle r="38" fill={NAVY} />
        <circle r="38" fill="none" stroke={TEAL} strokeWidth="1.5" opacity="0.4" className="pulse-ring" style={{ transformOrigin: "0px 0px" }} />
        <text x="0" y="6" textAnchor="middle" fill="#e7edf5" fontSize="20" fontWeight="500">B</text>
        <text x="0" y="60" textAnchor="middle" fill="#8ea3bd" fontSize="12">Buyer agent</text>
      </g>

      {/* Escrow node (hexagon) */}
      <g transform="translate(350,210)">
        <polygon points="0,-42 36,-21 36,21 0,42 -36,21 -36,-21" fill={NAVY} stroke={TEAL} strokeWidth="1.5" />
        <path d="M -10 -4 L -10 -12 A 10 10 0 0 1 10 -12 L 10 -4" fill="none" stroke={TEAL} strokeWidth="3" strokeLinecap="round" />
        <rect x="-13" y="-4" width="26" height="18" rx="3" fill={TEAL} />
        <text x="0" y="60" textAnchor="middle" fill="#8ea3bd" fontSize="12">Escrow</text>
      </g>

      {/* Worker node */}
      <g transform="translate(600,210)">
        <circle r="38" fill={NAVY} />
        <text x="0" y="6" textAnchor="middle" fill="#e7edf5" fontSize="20" fontWeight="500">W</text>
        <text x="0" y="60" textAnchor="middle" fill="#8ea3bd" fontSize="12">Worker agent</text>
      </g>
    </svg>
  );
}
