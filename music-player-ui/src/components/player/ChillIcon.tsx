// import React from 'react';

interface ChillIconProps {
  isActive: boolean;
}

// ── FIXED BEZIER PATHS (Restored the missing Lottie Tangent Math) ──
const WAVE_PATHS = [
  'M 6.887 40.274 C 6.887 40.274, 11.77 36.676, 17.98 37.996 C 23.488 39.167, 26.467 41.414, 32.458 40.938 C 38.831 40.432, 41.113 37.536, 41.113 37.536',
  'M 6.887 33.733 C 6.887 33.733, 11.77 30.135, 17.98 31.455 C 23.488 32.626, 26.467 34.873, 32.458 34.397 C 38.831 33.891, 41.113 30.995, 41.113 30.995',
  'M 6.887 27.192 C 6.887 27.192, 11.77 23.594, 17.98 24.914 C 23.488 26.085, 26.467 28.332, 32.458 27.856 C 38.831 27.350, 41.113 24.454, 41.113 24.454'
];

const BLOB_F0 = 'M 31.747 12.124 C 32.805 13.295 32.71 15.096 31.546 16.161 C 30.058 17.524 27.328 19.002 22.738 18.374 C 16.778 17.56 13.239 14.959 11.296 12.87 C 9.928 11.399 10.429 9.032 12.279 8.249 C 14.841 7.166 18.944 6.261 24.221 7.87 C 28.325 9.121 30.555 10.804 31.747 12.124 Z';
const BLOB_F60 = 'M 31.293 11.116 C 32.642 11.936 33.065 13.688 32.255 15.042 C 31.219 16.773 29.025 18.969 24.447 19.68 C 18.503 20.603 15.213 21.126 12.484 20.294 C 10.563 19.708 9.808 17.408 11.016 15.803 C 12.689 13.581 17.35 9.157 22.867 9.19 C 27.157 9.216 29.773 10.192 31.293 11.116 Z';

const L1_PATH_F0  = 'M 33.291 14.167 C 35.359 14.211 37.190 14.061 38.679 13.853';
const L1_PATH_F60 = 'M 32.541 13.792 C 33.875 13.594 36.038 14.437 38.686 15.353';

const L2G1_PATH_F0  = 'M 19.810 11.800 L 32.480 14.130';
const L2G1_PATH_F60 = 'M 20.122 14.862 L 32.480 14.130';

export const ChillIcon = ({ isActive }: ChillIconProps) => {
  return (
    <div 
      className={`chill-icon-container ${isActive ? 'is-active' : ''}`}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '14px', height: '14px', flexShrink: 0 }}
    >
      <svg
        viewBox="0 0 48 48"
        width="25"
        height="25"
        style={{ display: 'block', overflow: 'visible', opacity: isActive ? 1.0 : 0.6, transition: 'opacity 0.2s ease' }}
      >
        {/* Layer 3: Three fluid wavy lines */}
        {WAVE_PATHS.map((path, idx) => (
          <path
            key={`wave-${idx}`}
            className={`smooth-wave smooth-wave-${idx + 1}`}
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
          />
        ))}

        {/* Layer 2 Group 2: Morphing pill blob */}
        <path
          className="smooth-blob"
          d={BLOB_F0}
          fill="none" /* Fixed: Kills the hardcoded white block */
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Layer 2 Group 1: Background reference line */}
        <path
          className="smooth-l2g1"
          d={L2G1_PATH_F0}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Layer 1: Highlight wiggle line */}
        <path
          className="smooth-l1"
          d={L1_PATH_F0}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <style>{`
        /* Only run complex path morphing when the icon is actually selected */
        .is-active .smooth-blob { animation: anim-blob 2s cubic-bezier(0.333,0,0.667,1) infinite both; will-change: d; }
        .is-active .smooth-l1   { animation: anim-l1 2s cubic-bezier(0.333,0,0.667,1) infinite both; will-change: d; }
        .is-active .smooth-l2g1 { animation: anim-l2g1 2s cubic-bezier(0.333,0,0.667,1) infinite both; will-change: d; }
        
        .is-active .smooth-wave { animation: anim-trim 2s cubic-bezier(0.333,0,0.667,1) infinite both; will-change: stroke-dashoffset; }
        
        .smooth-wave-1 { animation-delay: 0ms !important; opacity: 0.9; }
        .smooth-wave-2 { animation-delay: -80ms !important; opacity: 0.6; }
        .smooth-wave-3 { animation-delay: -160ms !important; opacity: 0.3; }

        @keyframes anim-blob { 0%, 100% { d: path('${BLOB_F0}'); } 50% { d: path('${BLOB_F60}'); } }
        @keyframes anim-l1   { 0%, 100% { d: path('${L1_PATH_F0}'); } 50% { d: path('${L1_PATH_F60}'); } }
        @keyframes anim-l2g1 { 0%, 100% { d: path('${L2G1_PATH_F0}'); } 50% { d: path('${L2G1_PATH_F60}'); } }
        @keyframes anim-trim { 0%, 100% { stroke-dashoffset: 0; } 50% { stroke-dashoffset: 1; } }
      `}</style>
    </div>
  );
};