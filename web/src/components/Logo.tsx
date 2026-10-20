/** Huddle mark: three overlapping "heads" gathered under a speech-bubble tail. Original artwork. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" role="img" aria-label="Huddle logo">
      <defs>
        <linearGradient id="huddle-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff8a3d" />
          <stop offset="1" stopColor="#e8480c" />
        </linearGradient>
      </defs>
      <path d="M10 2h16a8 8 0 0 1 8 8v11a8 8 0 0 1-8 8h-9l-7 5v-5.4A8 8 0 0 1 2 21V10a8 8 0 0 1 8-8z" fill="url(#huddle-g)" />
      <circle cx="12.5" cy="20" r="5.6" fill="#ffd8bf" stroke="#e8590c" strokeWidth="1.5" />
      <circle cx="23.5" cy="20" r="5.6" fill="#15303a" stroke="#e8590c" strokeWidth="1.5" />
      <circle cx="18" cy="12.5" r="5.6" fill="#fff" stroke="#e8590c" strokeWidth="1.5" />
    </svg>
  );
}
