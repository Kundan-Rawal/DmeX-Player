import React, { useRef, useEffect, useCallback,useState } from 'react';
import { NavView, IS_MOBILE } from '../../types'; 
import { X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
const IS_ANDROID = /android/i.test(navigator.userAgent);

interface TopNavProps {
  currentView: NavView;
  setCurrentView: (view: NavView) => void;
  handleAddFolder: () => void;
  handleClearLibrary: () => void; // <-- ADD THIS
  isLoading: boolean;
  mobileSearchOpen: boolean;
  setMobileSearchOpen: (open: boolean) => void;
  toggleTheme: () => void;
  onOpenSettings: () => void;
}

export const TopNav = ({
  currentView, setCurrentView, handleAddFolder, handleClearLibrary, isLoading,
  mobileSearchOpen, setMobileSearchOpen, toggleTheme, onOpenSettings
}: TopNavProps) => {
  const appWindow = !IS_MOBILE ? getCurrentWindow() : null;
  const navRef = useRef<HTMLElement>(null);
  const stateUpdateTimeoutRef = useRef<number | undefined>(undefined);
  const [isKebabOpen, setIsKebabOpen] = useState(false);

  const TABS = [
    { id: 'FAVORITES', label: 'Favourites' },
    { id: 'PLAYLIST_GALLERY', label: 'Playlists' },
    { id: 'ALL', label: 'Tracks' },
    { id: 'ALBUMS', label: 'Albums' }, // FIXED
    { id: 'ARTIST', label: 'Artists' }
  ];

  // ====================================================================
  // THE 60FPS PHYSICS ENGINE: Continuous Scaling & Opacity
  // ====================================================================
  const updateScales = useCallback(() => {
    if (!navRef.current || !IS_MOBILE) return;
    
    // THE FIX: Use activeId to identify which tab should be at 1.20x scale
    const activeId = currentView.startsWith('PLAYLIST_') ? 'PLAYLIST_GALLERY' : 
                     currentView.startsWith('ALBUM_') ? 'ALBUMS' : currentView;
                     
    const container = navRef.current;
    const centerLine = container.scrollLeft + container.clientWidth / 2;
    const maxDist = 140; 

    let closestView: string | null = null;
    let minDiff = Infinity;

    Array.from(container.children).forEach((child) => {
      if (child.tagName === 'BUTTON') {
        const el = child as HTMLElement;
        const viewId = el.dataset.view;
        const elCenter = el.offsetLeft + el.offsetWidth / 2;
        const distance = Math.abs(centerLine - elCenter);
        
        let ratio = 1 - (distance / maxDist);
        if (ratio < 0) ratio = 0;
        
        const easeRatio = ratio * (2 - ratio); 
        
        // OPTIMIZATION: If this button is the activeId, we give it priority scaling
        const isCurrent = viewId === activeId;
        const scale = (isCurrent ? 1.0 : 0.85) + (easeRatio * 0.35);
        const opacity = (isCurrent ? 0.7 : 0.4) + (easeRatio * 0.6);

        el.style.setProperty('transform', `scale(${scale})`, 'important');
        el.style.setProperty('opacity', Math.min(opacity, 1).toString(), 'important');

        if (distance < minDiff) {
          minDiff = distance;
          closestView = viewId || null;
        }
      }
    });

    // THE FLIP-FLOP KILLER: Only update the React state when the user completely stops scrolling
    clearTimeout(stateUpdateTimeoutRef.current);
    stateUpdateTimeoutRef.current = setTimeout(() => {
      if (closestView && minDiff < 30) {
        if (closestView !== currentView && !(closestView === 'PLAYLIST_GALLERY' && currentView.startsWith('PLAYLIST_'))) {
          setCurrentView(closestView as NavView);
        }
      }
    }, 150); // Wait 150 milliseconds after motion stops to commit the change
  }, [currentView, setCurrentView]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || !IS_MOBILE) return;
    
    let rafId: number;
    const handleScroll = () => { rafId = requestAnimationFrame(updateScales); };
    
    nav.addEventListener('scroll', handleScroll, { passive: true });
    updateScales(); 
    
    return () => {
      nav.removeEventListener('scroll', handleScroll);
      cancelAnimationFrame(rafId);
    };
  }, [updateScales]);

  // THE JERK KILLER: Only auto-scroll if the change came from a click or another page.
  useEffect(() => {
    if (!navRef.current || !IS_MOBILE) return;
    
    // THE FIX: Use the variable you declared!
    const activeId = currentView.startsWith('PLAYLIST_') ? 'PLAYLIST_GALLERY' : 
                     currentView.startsWith('ALBUM_') ? 'ALBUMS' : currentView;
    
    // Use activeId here instead of raw currentView
    const activeBtn = navRef.current.querySelector(`button[data-view="${activeId}"]`) as HTMLElement;
    if (!activeBtn) return;

    const container = navRef.current;
    const center = container.scrollLeft + container.clientWidth / 2;
    const btnCenter = activeBtn.offsetLeft + activeBtn.offsetWidth / 2;

    if (Math.abs(center - btnCenter) > 20) {
      activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [currentView]);

  const handleTabClick = (view: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (!IS_MOBILE) { setCurrentView(view as NavView); return; }
    setCurrentView(view as NavView);
    e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };

  return (
    <>
      {!IS_MOBILE && appWindow && (
        <div className="samsung-system-titlebar " data-tauri-drag-region="true">
          <div className="window-controls ">
            <button className="win-btn min" onClick={() => appWindow.minimize()}>—</button>
            <button className="win-btn max" onClick={() => appWindow.toggleMaximize()}>□</button>
            <button className="win-btn close" onClick={() => appWindow.close()} style={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}><X size={14} /></button>
          </div>
        </div>
      )}

      <div className="samsung-header-wrapper" data-tauri-drag-region="true">
        <header className="samsung-top-bar">
          <div className="samsung-logo-area" data-tauri-drag-region="true">
            <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>DmeX </span>
            <span style={{ fontWeight: 400, color: 'var(--text-primary)' }}>Player</span>
          </div>

          <div className="samsung-actions">
            {IS_ANDROID ? (
              /* ============================================================== */
              /* ANDROID LAYOUT: Search Icon + 3-Dot Kebab Menu                 */
              /* ============================================================== */
              <>
                <button className="samsung-icon-btn" onClick={() => setMobileSearchOpen(!mobileSearchOpen)}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                </button>
                
                <div style={{ position: 'relative' }}>
                  <button className="samsung-icon-btn" onClick={() => setIsKebabOpen(!isKebabOpen)}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                  </button>
                  
                  {isKebabOpen && (
                    <>
                      {/* Invisible backdrop to catch clicks outside the menu */}
                      <div style={{ position: 'fixed', inset: 0, zIndex: 998 }} onClick={() => setIsKebabOpen(false)} />
                      
                      {/* THE GLASSMORPHISM BOMB: Dark blurred background with subtle white borders */}
                      <div className="fade-in" style={{ 
                        position: 'absolute', top: '100%', right: 0, zIndex: 999, marginTop: '24px', 
                        background: 'rgba(15, 15, 15, 0.75)', 
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        border: '1px solid rgba(255, 255, 255, 0.1)', 
                        borderRadius: '16px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px', 
                        minWidth: '200px', boxShadow: '0 16px 40px rgba(0,0,0,0.6)' 
                      }}>
                        
                        <button onClick={() => { handleAddFolder(); setIsKebabOpen(false); }} style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', background: 'transparent', border: 'none', color: '#ffffff', fontSize: '15px', fontWeight: 600, cursor: 'pointer', borderRadius: '8px' }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                          Add Folder
                        </button>
                        
                        <button onClick={() => { toggleTheme(); setIsKebabOpen(false); }} style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', background: 'transparent', border: 'none', color: '#ffffff', fontSize: '15px', fontWeight: 600, cursor: 'pointer', borderRadius: '8px' }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                          Toggle Theme
                        </button>

                        <button onClick={() => { onOpenSettings(); setIsKebabOpen(false); }} style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', background: 'transparent', border: 'none', color: '#ffffff', fontSize: '15px', fontWeight: 600, cursor: 'pointer', borderRadius: '8px' }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                          Settings
                        </button>
                        
                        <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.1)', margin: '4px 0' }} />
                        
                        <button onClick={() => { handleClearLibrary(); setIsKebabOpen(false); }} style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', background: 'transparent', border: 'none', color: '#ff4444', fontSize: '15px', fontWeight: 600, cursor: 'pointer', borderRadius: '8px' }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                          Flush Directory
                        </button>
                        
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : (
              /* ============================================================== */
              /* WINDOWS LAYOUT: The Unaltered 4-Button Array                   */
              /* ============================================================== */
              <>
                <button className="samsung-icon-btn" onClick={handleClearLibrary} disabled={isLoading} style={{ color: '#e83040' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
                <button className="samsung-icon-btn" onClick={handleAddFolder} disabled={isLoading}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                </button>
                <button className="samsung-icon-btn" onClick={() => setMobileSearchOpen(!mobileSearchOpen)}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                </button>
                <button className="samsung-icon-btn" onClick={toggleTheme}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                </button>
                <button className="samsung-icon-btn" onClick={onOpenSettings}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                </button>
              </>
            )}
          </div>
        </header>

        <nav className="samsung-nav-tabs" data-tauri-drag-region="true" ref={navRef}>
          <div className="nav-spacer" />
          {TABS.map(tab => {
            const isActive = currentView === tab.id || 
                             (tab.id === 'PLAYLIST_GALLERY' && currentView.startsWith('PLAYLIST_')) ||
                             (tab.id === 'ALBUMS' && currentView.startsWith('ALBUM_'));
            return (
              <button 
                key={tab.id} data-view={tab.id}
                className={isActive ? 'active' : ''}
                onClick={(e) => handleTabClick(tab.id, e)}
              >
                {tab.label}
              </button>
            )
          })}
          <div className="nav-spacer" />
        </nav>
      </div>
    </>
  );
};