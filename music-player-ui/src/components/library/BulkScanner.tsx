import { Track } from '../../types'; // Adjust path if needed
import { PauseCircle, Zap, Play, Pause, XCircle } from 'lucide-react';

interface BulkScannerProps {
  playlist: Track[];
  bulkScanActive: boolean;
  bulkScanPaused: boolean;
  bulkScanDone: number;
  bulkScanTotal: number;
  isBulkScanOpen: boolean;
  setIsBulkScanOpen: (v: boolean) => void;
  startBulkCategoryScan: () => void;
  pauseBulkScan: () => void;
  resumeBulkScan: () => void;
  stopBulkScan: () => void;
}

export const BulkScanner = ({
  playlist, bulkScanActive, bulkScanPaused, bulkScanDone, bulkScanTotal,
  isBulkScanOpen, setIsBulkScanOpen, startBulkCategoryScan, pauseBulkScan,
  resumeBulkScan, stopBulkScan
}: BulkScannerProps) => {
  
  const unscannedCount = playlist.filter(t => !t.profile).length;
  if (!bulkScanActive && unscannedCount === 0) return null;
  
  const pct = bulkScanTotal > 0 ? Math.round((bulkScanDone / bulkScanTotal) * 100) : 0;

  return (
    <>
      <button className="bulk-scan-fab fade-in" onClick={() => setIsBulkScanOpen(true)}>
        <span className="fab-text">{bulkScanActive ? (bulkScanPaused ? `Paused ${pct}%` : `Scanning ${pct}%`) : `Optimize (${unscannedCount})`}</span>
      </button>
      
      {isBulkScanOpen && (
        <div className="folder-modal-overlay" onClick={() => setIsBulkScanOpen(false)}>
          <div className="folder-modal" onClick={e => e.stopPropagation()}>
            <div className="folder-modal-header">
              <h2>Audio Optimization</h2>
              <button className="folder-modal-close" onClick={() => setIsBulkScanOpen(false)}>×</button>
            </div>
            <div className="bulk-scan-modal-content">
              <p className="folder-modal-hint" style={{ marginBottom: 20, padding: 0 }}>
                {bulkScanActive ? "Analyzing audio fingerprints in the background to instantly apply the perfect DSP profile when you play a song." : `${unscannedCount} tracks haven't been analyzed yet. Run a background scan to enable instant Smart DSP loading.`}
              </p>
              {bulkScanActive ? (
                <div className="bulk-scan-active-view">
                  <div className="bulk-scan-info">
                    <div className="bulk-scan-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>{bulkScanPaused ? <><PauseCircle size={14} /> Paused</> : <><Zap size={14} /> Scanning</>}</div>
                    <span className="bulk-scan-pct">{bulkScanDone} / {bulkScanTotal} ({pct}%)</span>
                  </div>
                  <div className="bulk-scan-bar" style={{ marginBottom: 20 }}>
                    <div className="bulk-scan-fill" style={{ width: `${pct}%`, background: 'var(--theme-color)' }} />
                  </div>
                  <div className="bulk-scan-actions" style={{ display: 'flex', gap: 10 }}>
                    {bulkScanPaused 
                      ? <button className="folder-modal-scan-all" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} onClick={resumeBulkScan}><Play size={16} /> Resume</button> 
                      : <button className="folder-modal-scan-all" style={{ flex: 1, background: 'var(--bg-raised)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} onClick={pauseBulkScan}><Pause size={16} /> Pause</button>
                    }
                    <button className="folder-modal-scan-all" style={{ flex: 1, background: '#e83040', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} onClick={stopBulkScan}><XCircle size={16} /> Stop</button>
                  </div>
                </div>
              ) : (
                <button className="folder-modal-scan-all" onClick={() => { startBulkCategoryScan(); setIsBulkScanOpen(false); }}>Start Background Scan</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};