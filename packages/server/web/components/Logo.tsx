import { useId } from "react";

/** The secenv mark: KEY = value rows with one masked secret. Mirrors web/icon.svg. */
export function Logo({ className = "size-7" }: { className?: string }) {
  // Unique per instance: a gradient defined inside a display:none copy can't be referenced by others.
  const gradientId = `secenv-logo-bg-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 64 64" fill="none" className={`shrink-0 ${className}`} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2a2a2a" />
          <stop offset="1" stopColor="#0a0a0a" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${gradientId})`} />
      <rect x="13" y="16" width="13" height="6" rx="3" fill="#fff" />
      <rect x="30" y="16" width="21" height="6" rx="3" fill="#fff" fillOpacity=".32" />
      <rect x="13" y="29" width="13" height="6" rx="3" fill="#fff" />
      <circle cx="33" cy="32" r="3" fill="#5aa9e6" />
      <circle cx="41" cy="32" r="3" fill="#5aa9e6" />
      <circle cx="49" cy="32" r="3" fill="#5aa9e6" />
      <rect x="13" y="42" width="13" height="6" rx="3" fill="#fff" />
      <rect x="30" y="42" width="14" height="6" rx="3" fill="#fff" fillOpacity=".32" />
    </svg>
  );
}
