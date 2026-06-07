// import React from 'react';

interface HDCrystalIconProps {
  isActive: boolean;
}

export const HDCrystalIcon = ({ isActive }: HDCrystalIconProps) => {
  // THE CONVEYOR BELT TRICK
  // State A: Line 1 is hidden on the Left Edge (6,3 -> 2,9 -> 12,22)
  const stateA = "M 6,3 L 2,9 L 12,22 M 9,3 L 7,9 L 12,22 M 12,3 L 12,9 L 12,22 M 15,3 L 17,9 L 12,22";

  // State B: Line 4 is hidden on the Right Edge (18,3 -> 22,9 -> 12,22)
  // Visually, State B is geometrically identical to State A.
  const stateB = "M 9,3 L 7,9 L 12,22 M 12,3 L 12,9 L 12,22 M 15,3 L 17,9 L 12,22 M 18,3 L 22,9 L 12,22";

  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor" /* Inherits text color automatically */
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ opacity: isActive ? 1.0 : 0.6, flexShrink: 0, transition: 'opacity 0.2s' }}
    >
      {/* 1. Static Outer Diamond Shell */}
      <polygon points="6,3 18,3 22,9 12,22 2,9" />
      <line x1="2" y1="9" x2="22" y2="9" />

      {/* 2. Continuously Rotating Internal Facet Lines */}
      <path d={stateA}>
        {isActive && (
          <animate
            attributeName="d"
            dur="1.5s"
            repeatCount="indefinite"
            calcMode="linear"
            values={`${stateA}; ${stateB}`}
          />
        )}
      </path>
    </svg>
  );
};