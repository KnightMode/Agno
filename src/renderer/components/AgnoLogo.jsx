import React from 'react';

export default function AgnoLogo({ size = 18, className = '' }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="19" height="19" rx="6" fill="currentColor" fillOpacity="0.08" />
      <path d="M8 15.8L12 7.2L16 15.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.7 12.6H14.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="16.9" cy="8.1" r="1.3" fill="var(--accent)" />
      <circle cx="7.2" cy="17" r="1.1" fill="var(--accent)" fillOpacity="0.78" />
    </svg>
  );
}

