import { memo, useRef, useEffect } from 'react';
import { CustomPlaylist } from '../types/index'; // Adjust path if needed

export const FolderModal = memo(({ onClose, onScan }: { onClose:()=>void; onScan:(path:string)=>void }) => {
  const commonFolders = [
    { label:'Music', path:'/storage/emulated/0/Music' },
    { label:'⬇Downloads', path:'/storage/emulated/0/Download' },
    { label:'Downloads (alt)', path:'/storage/emulated/0/Downloads' },
    { label:'Internal Storage', path:'/storage/emulated/0' },
    { label:'SD Card', path:'/storage/sdcard1/Music' },
    { label:'SD Card Root', path:'/storage/sdcard1' },
  ];
  return (
    <div className="folder-modal-overlay" onClick={onClose}>
      <div className="folder-modal" onClick={e=>e.stopPropagation()}>
        <div className="folder-modal-header"><h2>Choose Music Folder</h2><button className="folder-modal-close" onClick={onClose}>×</button></div>
        <p className="folder-modal-hint">Tap a folder to scan it. All audio files inside will be added to your library.</p>
        <div className="folder-modal-list">
          {commonFolders.map(f=>(
            <button key={f.path} className="folder-modal-item" onClick={()=>{onScan(f.path);onClose();}}>
              <span className="folder-modal-icon">{f.label.split(' ')[0]}</span>
              <div><div className="folder-modal-name">{f.label.slice(f.label.indexOf(' ')+1)}</div><div className="folder-modal-path">{f.path}</div></div>
            </button>
          ))}
        </div>
        <div className="folder-modal-footer">
          <button className="folder-modal-scan-all" onClick={()=>{onScan('ALL');onClose();}}>📂 Scan All Common Folders</button>
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

export const SettingsModal = memo(({ apiKey, setApiKey, onClose, onSave }: { apiKey: string, setApiKey: (k:string)=>void, onClose: ()=>void, onSave: ()=>void }) => {
  return (
    <div className="folder-modal-overlay" onClick={onClose}>
      <div className="folder-modal" onClick={e=>e.stopPropagation()} style={{ maxWidth: '400px', height: 'auto', paddingBottom: '20px' }}>
        <div className="folder-modal-header"><h2>Settings</h2><button className="folder-modal-close" onClick={onClose}>×</button></div>
        
        <div style={{ padding: '0 20px', marginTop: '10px' }}>
          <h3 style={{ fontSize: '14px', marginBottom: '8px', opacity: 0.8 }}>Gemini API Key (AI Lyrics)</h3>
          <p style={{ fontSize: '12px', opacity: 0.6, marginBottom: '12px', lineHeight: '1.4' }}>
            Enter your Google Gemini API Key to enable AI-powered lyrics fetching and metadata correction. 
            Your key is saved locally in the database.
          </p>
          <input 
            type="password"
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
            onClick={() => { onSave(); onClose(); }}
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
});