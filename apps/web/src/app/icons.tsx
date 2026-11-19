import type { ReactNode } from "react";

/** House glyphs (ADR 0032): drawn in `currentColor`, always decorative; the control beside them carries the name. */
const ICONS = {
  run: <path d="M4.5 3v10l8-5z" fill="currentColor" />,
  pause: <path d="M5 3.5v9M11 3.5v9" strokeWidth="2.5" strokeLinecap="butt" />,
  step: (
    <>
      <path d="M3.5 3.5v9l6.5-4.5z" fill="currentColor" />
      <path d="M12.5 3.5v9" strokeWidth="2" />
    </>
  ),
  reset: <path d="M3 8a5 5 0 1 0 1.6-3.7L3 5.8M3 2.6v3.2h3.2" />,
  undo: <path d="M5.5 3 2.5 6l3 3M2.5 6h7a3.5 3.5 0 0 1 0 7H6.5" />,
  redo: <path d="m10.5 3 3 3-3 3M13.5 6h-7a3.5 3.5 0 0 0 0 7h3" />,
  import: <path d="M8 2.5v7.5M4.8 7 8 10.2 11.2 7M2.5 13.5h11" />,
  export: <path d="M8 10.5V3M4.8 6 8 2.8 11.2 6M2.5 13.5h11" />,
  link: <path d="m6.3 9.7 3.4-3.4M7.2 4.3l1-1a3 3 0 0 1 4.5 4.5l-1 1M8.8 11.7l-1 1a3 3 0 0 1-4.5-4.5l1-1" />,
  more: <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth="2.6" />,
  plus: <path d="M8 3v10M3 8h10" />,
  minus: <path d="M3 8h10" />,
  fit: <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  bookmark: <path d="M4 2.5h8v11L8 10.5l-4 3z" />,
  check: <path d="m3 8.5 3.2 3.2L13 4.8" />,
  back: <path d="M9.5 3.5 5 8l4.5 4.5" />,
  chevron: <path d="m6 3.5 4.5 4.5L6 12.5" />,
  keyboard: (
    <>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
      <path d="M4.5 6.5h.01M8 6.5h.01M11.5 6.5h.01M5.5 9.7h5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

const body = {
  and: "M7 3h4.5a6 6 0 0 1 0 12H7z",
  nand: "M5.5 3H10a6 6 0 0 1 0 12H5.5z",
  or: "M6 3c3.5 0 7.5.8 11 6-3.5 5.2-7.5 6-11 6 1.8-3.6 1.8-8.4 0-12z",
  nor: "M4.5 3c3.5 0 7.5.8 11 6-3.5 5.2-7.5 6-11 6 1.8-3.6 1.8-8.4 0-12z",
  xor: "M7 3c3.5 0 7.5.8 11 6-3.5 5.2-7.5 6-11 6 1.8-3.6 1.8-8.4 0-12z",
  xnor: "M6 3c3 0 6.7.8 10 6-3.3 5.2-7 6-10 6 1.8-3.6 1.8-8.4 0-12z",
};
const bubble = (cx: number) => <circle cx={cx} cy="9" r="1.6" />;

/** Each palette tile's symbol, by the tile's name; the gates use their standard shapes. */
const GLYPHS: Record<string, ReactNode> = {
  Switch: <path d="M2 12h6l7-6M16 12h6" />,
  Clock: <path d="M2 13h4V5h6v8h6V5h4" />,
  Keyboard: (
    <>
      <rect x="3" y="4" width="18" height="10" rx="1.5" />
      <path d="M6.5 7.5h.01M10.2 7.5h.01M13.9 7.5h.01M17.5 7.5h.01M8 11h8" />
    </>
  ),
  LED: (
    <>
      <circle cx="12" cy="10" r="4.5" />
      <path d="M2 10h5.5M16.5 10H22M12 1.8v2M6.5 3.8l1.2 1.5M17.5 3.8l-1.2 1.5" />
    </>
  ),
  "Seven-segment": <path d="M9.5 2.5h5M8 4v4M16 4v4M9.5 9h5M8 10v4M16 10v4M9.5 15.5h5" />,
  Screen: (
    <>
      <rect x="4" y="2.5" width="16" height="11" rx="1.2" />
      <path d="M9 16h6M8 6.2h.01M11 6.2h.01M8 9.5h.01M14 9.5h.01M16 6.2h.01" />
    </>
  ),
  NOT: (
    <>
      <path d="M7 3.5v11L15.5 9z" />
      <path d="M2 9h5M18.8 9H22" />
      {bubble(17.2)}
    </>
  ),
  AND: <path d={`${body.and}M2 6h5M2 12h5M17.5 9H22`} />,
  NAND: (
    <>
      <path d={`${body.nand}M1.5 6h4M1.5 12h4M19.2 9h3.3`} />
      {bubble(17.6)}
    </>
  ),
  OR: <path d={`${body.or}M2 6h5.2M2 12h5.2M17 9h5`} />,
  NOR: (
    <>
      <path d={`${body.nor}M1.5 6h4.2M1.5 12h4.2M18.8 9h3.7`} />
      {bubble(17.2)}
    </>
  ),
  XOR: <path d={`${body.xor}M4.5 3c1.8 3.6 1.8 8.4 0 12M1.5 6h4.4M1.5 12h4.4M18 9h4.5`} />,
  XNOR: (
    <>
      <path d={`${body.xnor}M3.6 3c1.8 3.6 1.8 8.4 0 12M1 6h4M1 12h4M19.3 9h3.5`} />
      {bubble(17.7)}
    </>
  ),
  Splitter: <path d="M2 9h7M9 3v12M9 4.5h13M9 9h13M9 13.5h13" />,
  Merger: <path d="M22 9h-7M15 3v12M15 4.5H2M15 9H2M15 13.5H2" />,
  Label: <path d="M3 4.5h12l5.5 4.5-5.5 4.5H3zM7 9h.01" />,
  "D flip-flop": (
    <>
      <rect x="6" y="2.5" width="12" height="13" rx="1" />
      <path d="M2 6h4M2 13h4M18 6h4M6 10.8 9 13l-3 2.2" />
    </>
  ),
  Register: (
    <>
      <rect x="5" y="3.5" width="14" height="11" rx="1" />
      <path d="M9.7 3.5v11M14.3 3.5v11M1.5 9H5M19 9h3.5" />
    </>
  ),
  ROM: (
    <>
      <rect x="5" y="2.5" width="14" height="13" rx="1" />
      <path d="M8 6h8M8 9h8M8 12h5M2 6h3M2 12h3M19 9h3" />
    </>
  ),
  RAM: (
    <>
      <rect x="5" y="2.5" width="14" height="13" rx="1" />
      <path d="M12 2.5v13M5 7h14M5 11h14M2 6h3M2 12h3M19 9h3" />
    </>
  ),
  Chip: (
    <>
      <rect x="6.5" y="3" width="11" height="12" rx="1" />
      <path d="M3 6h3.5M3 9h3.5M3 12h3.5M17.5 6H21M17.5 12H21" />
    </>
  ),
};

/** A part's symbol; anything without one of its own (a custom component) is drawn as a chip. */
export function PartGlyph({ name }: { name?: string }) {
  return (
    <svg
      className="glyph"
      viewBox="0 0 24 18"
      width="24"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[name ?? ""] ?? GLYPHS.Chip}
    </svg>
  );
}
