// import React from 'react';

interface ImmersiveIconProps {
  isActive: boolean;
}

export const ImmersiveIcon = ({ isActive }: ImmersiveIconProps) => {
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];

  return (
    <div 
      className={`immersive-icon-container ${isActive ? 'is-active' : ''}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '14px',
        height: '14px',
        flexShrink: 0
      }}
    >
      <svg
        viewBox="0 0 48 48"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="3" /* Made slightly thicker for pristine crispness at small scale */
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          opacity: isActive ? 1.0 : 0.5,
          transition: 'opacity 0.2s ease',
          overflow: 'visible',
          willChange: 'opacity' /* Signals hardware layer preparation to GPU */
        }}
      >
        {/* 1. STATIONARY CORE */}
        <g>
          <circle cx="24" cy="24" r="9" fill="var(--bg-surface, #000)" strokeWidth="3" />
          <text
            x="24"
            y="28.5"
            fontSize="11.5"
            fontWeight="900"
            fill="currentColor"
            stroke="none"
            textAnchor="middle"
            style={{ 
              fontFamily: 'system-ui, -apple-system, sans-serif', 
              letterSpacing: '-0.5px' 
            }}
          >
            3D
          </text>
        </g>

        {/* 2. OPTIMIZED SATELLITE ENGINE */}
        <g>
          {angles.map((angle, index) => (
            <g key={angle} transform={`rotate(${angle} 24 24)`}>
              
              {/* Connector Ray: Static layout, animation handles pure opacity pulse */}
              <line
                className="immersion-beam"
                x1="24"
                y1="15"
                x2="24"
                y2="7"
                strokeDasharray="2 3"
                style={{
                  animationDelay: `${index * 0.125}s`
                }}
              />

              {/* Satellite Dot: Static position, animation handles pure opacity sweep */}
              <circle
                className="immersion-satellite"
                cx="24"
                cy="4"
                r="2.5"
                fill="currentColor"
                style={{
                  animationDelay: `${index * 0.125}s`
                }}
              />
            </g>
          ))}
        </g>
      </svg>

      <style>{`
        /* --- 1. CORE BREATHING (PURE OPACITY) --- */
        @keyframes coreGlow {
          0% { opacity: 1; }
          50% { opacity: 0.75; }
          100% { opacity: 1; }
        }
        .is-active .immersion-core-group {
          animation: coreGlow 2s ease-in-out infinite;
        }

        /* --- 2. RADAR WAVE (PURE OPACITY SWEEP - 0% LAYOUT COST) --- */
        @keyframes radarOpacitySweep {
          0% { opacity: 0.15; }
          15% { opacity: 1; }
          40% { opacity: 0.3; }
          100% { opacity: 0.15; }
        }
        .is-active .immersion-satellite {
          animation: radarOpacitySweep 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
          will-change: opacity;
        }

        /* --- 3. BEAM PULSE (Killed stroke-dashoffset vector calculations) --- */
        @keyframes beamPulse {
          0% { opacity: 0.2; }
          15% { opacity: 0.8; }
          40% { opacity: 0.4; }
          100% { opacity: 0.2; }
        }
        .is-active .immersion-beam {
          animation: beamPulse 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
          will-change: opacity;
        }
      `}</style>
    </div>
  );
};