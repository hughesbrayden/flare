import React from 'react';

/**
 * Clean NFPA 170-inspired architectural / fire-service symbols in ink & semantic tones.
 */
export function StairIcon({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="16" height="16" stroke={color} strokeWidth="1.5" />
      <path d="M4 15H8V11H12V7H16" stroke={color} strokeWidth="1.6" strokeLinecap="square" />
    </svg>
  );
}

export function ElevatorExcludedIcon({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="16" height="16" stroke={color} strokeWidth="1.4" strokeDasharray="2 2" />
      <path d="M5 5L15 15M15 5L5 15" stroke={color} strokeWidth="1.4" />
    </svg>
  );
}

export function EntranceIcon({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 10H14M10 6L14 10L10 14" stroke={color} strokeWidth="1.6" strokeLinecap="square" />
      <path d="M16 4V16" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

export function ReportPinIcon({ size = 16, color = '#8a5a00' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="9" r="6" stroke={color} strokeWidth="1.6" strokeDasharray="3 2" />
      <path d="M10 6V9.5M10 12V12.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function FireDoorIcon({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 16V4H16" stroke={color} strokeWidth="1.5" />
      <path d="M4 16L13 7" stroke={color} strokeWidth="1.6" />
      <path d="M13 7A9 9 0 0 1 16 16" stroke={color} strokeWidth="1.2" strokeDasharray="2 2" />
    </svg>
  );
}
