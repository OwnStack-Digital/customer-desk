import type { CSSProperties } from "react";

const paths = {
  inbox: "M4 4h16l2 12v4H2v-4L4 4Zm-2 12h6l2 3h4l2-3h6",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  back: "M19 12H5m6-6-6 6 6 6",
  chevron: "m9 5 7 7-7 7",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  check: "m5 12 4 4L19 6",
  clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  alert:
    "M12 8v5m0 3h.01M10 3 2 18a2 2 0 0 0 2 3h16a2 2 0 0 0 2-3L14 3a2 2 0 0 0-4 0",
  send: "m22 2-7 20-4-9-9-4L22 2ZM11 13 22 2",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
  leaf: "M20 3C8 2 2 7 5 15s17 4 15-12ZM4 21 16 8",
  shield: "m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6l9-4Zm-5 10 3 3 7-7",
  refresh: "M20 7a9 9 0 1 0 1 9M20 2v6h-6",
  quote: "M6 2h9l5 5v15H4V2h2Zm8 0v6h6M8 12h8M8 16h5",
  mail: "M3 4h18v16H3V4Zm0 1 9 8 9-8",
  logout: "M9 3H3v18h6m6-15 6 6-6 6M8 12h13",
  close: "m6 6 12 12M6 18 18 6",
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 20,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
