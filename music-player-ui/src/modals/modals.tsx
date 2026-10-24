import { memo, useRef, useEffect, useState } from 'react';
import { Music2, HardDrive, Download, FolderOpen, X } from 'lucide-react';
import { IS_ANDROID } from '../types';
import { CustomSelect } from '../components/common/CustomSelect';
import { ToggleSwitch } from '../components/common/ToggleSwitch';
import { LibraryFilters, MINIMUM_DURATIONS } from '../utils/libraryFilters';
import { CustomPlaylist } from '../types/index'; // Adjust path if needed

export const FolderModal = memo(({ onClose, onScan }: { onClose: () => void; onScan: (path: string) => void }) => {
  const folders = [
    { label: 'Music folder', path: '/storage/emulated/0/Music', icon: Music2 },
    { label: 'Internal Storage', path: 'ALL', icon: HardDrive },
    { label: 'Downloads', path: '/storage/emulated/0/Download', icon: Download },
    { label: 'Custom', path: 'CUSTOM', icon: FolderOpen },
  ];
  return (
    <div className="folder-modal-overlay" onClick={onClose}>
      <div className="folder-modal" role="dialog" aria-modal="true" aria-label="Choose Music Folder" onClick={e => e.stopPropagation()}>
        <div className="folder-modal-header"><h2>Choose Music Folder</h2><button className="folder-modal-close" aria-label="Close" onClick={onClose}><X size={20} /></button></div>
        <div className="folder-modal-list">
          {folders.map(({ label, path, icon: Icon }) => (
            <button key={path} className="folder-modal-item" onClick={() => { onClose(); onScan(path); }}>
              <Icon size={22} aria-hidden="true" />
              <div><div className="folder-modal-name">{label}</div></div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

export const PlaylistPopup = memo(({ playlists, onClose, onCreate, onAdd, newPlaylistName, setNewPlaylistName }: {
  playlists: CustomPlaylist[]; onClose: () => void; onCreate: (name: string) => void;
  onAdd: (id: string) => void; newPlaylistName: string; setNewPlaylistName: (v: string) => void;
}) => {
  const canClose = useRef(false);
  useEffect(() => { const t = setTimeout(() => { canClose.current = true; }, 220); return () => clearTimeout(t); }, []);
  return (
    <div className="playlist-popup-overlay" onPointerDown={()=>{ if(canClose.current) onClose(); }}>
      <div className="playlist-popup-glass" onPointerDown={e=>e.stopPropagation()}>
        <div className="glass-menu-header">Add to Playlist</div>
        <div className="playlist-popup-list">
          {playlists.length===0
            ? <p className="playlist-popup-empty">No playlists yet — create one below.</p>
            : playlists.map(pl=>(
                <button key={pl.id} className="playlist-popup-item" onPointerDown={e=>e.stopPropagation()} onClick={()=>onAdd(pl.id)}>
                  <span className="playlist-popup-item-icon">📑</span>
                  <div className="playlist-popup-item-info"><span className="playlist-popup-item-name">{pl.name}</span><span className="playlist-popup-item-count">{pl.trackPaths.length} tracks</span></div>
                  <span className="playlist-popup-item-add">＋</span>
                </button>
              ))}
        </div>
        <div className="playlist-popup-divider" />
        <form onSubmit={(e) => { e.preventDefault(); if(newPlaylistName.trim()) onCreate(newPlaylistName.trim()); }} className="playlist-popup-form">
          <input autoFocus className="playlist-popup-input" placeholder="New playlist name…" value={newPlaylistName} onChange={e=>setNewPlaylistName(e.target.value)} onPointerDown={e=>e.stopPropagation()} />
          <button type="submit" className="playlist-popup-create-btn" onPointerDown={e=>e.stopPropagation()}>Create</button>
        </form>
      </div>
    </div>
  );
});

export const SettingsModal = memo(({ apiKey, setApiKey, filters, onClose, onSave }: { apiKey: string, setApiKey: (k:string)=>void, filters: LibraryFilters, onClose: ()=>void, onSave: (filters: LibraryFilters)=>Promise<void> }) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(filters);
  return (
    <div className="folder-modal-overlay" onClick={onClose}>
      <div className="folder-modal" onClick={e=>e.stopPropagation()} style={{ maxWidth: '400px', height: 'auto', maxHeight: '90dvh', overflowY: 'auto', paddingBottom: IS_ANDROID ? 'calc(52px + env(safe-area-inset-bottom, 0px))' : '20px' }}>
        <div className="folder-modal-header"><h2>Settings</h2><button className="folder-modal-close" onClick={onClose}>×</button></div>
        
        <div style={{ padding: '0 20px', marginTop: '10px' }}>
          <h3 style={{ fontSize: '14px', marginBottom: '16px' }}>Library filters</h3>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '18px', fontSize: '14px' }}>
            Minimum duration
            <CustomSelect label="Minimum duration" value={draft.minimumDuration} options={MINIMUM_DURATIONS.map(seconds => ({ value: String(seconds), label: seconds ? `${seconds} seconds` : 'Off' }))} onChange={value => setDraft(previous => ({ ...previous, minimumDuration: Number(value) }))} />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: '24px', fontSize: '14px' }}>
            <span>Skip call recordings</span>
            <ToggleSwitch label="Skip call recordings" checked={draft.skipCallRecordings} onChange={checked => setDraft(previous => ({ ...previous, skipCallRecordings: checked }))} />
          </div>
          <h3 style={{ fontSize: '14px', marginBottom: '8px', opacity: 0.8 }}>Gemini API Key (AI Lyrics)</h3>
          <p style={{ fontSize: '12px', opacity: 0.6, marginBottom: '12px', lineHeight: '1.4' }}>
            Optional: use Gemini to identify a song when standard lyrics search fails.
            Only song details are sent to Google. The key is stored on this device. Online lyrics search works without it.
          </p>
          <input 
            type="password"
            aria-label="Gemini API Key"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="AIzaSy..."
            style={{
              width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(0,0,0,0.2)', color: 'inherit', outline: 'none', marginBottom: '20px', fontSize: '14px'
            }}
          />
          
          <button 
            className="add-folder-btn" 
            style={{ width: '100%' }}
            disabled={saving}
            onClick={async () => { setSaving(true); setError(''); try { await onSave(draft); } catch { setError('Settings could not be saved. Please retry.'); } finally { setSaving(false); } }}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
    </div>
  );
});
