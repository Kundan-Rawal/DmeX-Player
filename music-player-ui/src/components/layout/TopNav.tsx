import React, { useRef, useEffect, useCallback } from 'react';
import { NavView, IS_MOBILE } from '../../types'; 
import { getCurrentWindow } from '@tauri-apps/api/window';

interface TopNavProps {
  currentView: NavView;
  setCurrentView: (view: NavView) => void;
  handleAddFolder: () => void;
  handleClearLibrary: () => void; // <-- ADD THIS
  isLoading: boolean;
  mobileSearchOpen: boolean;
  setMobileSearchOpen: (open: boolean) => void;
  toggleTheme: () => void;
}

export const TopNav = ({
  currentView, setCurrentView, handleAddFolder, handleClearLibrary, isLoading,
  mobileSearchOpen, setMobileSearchOpen, toggleTheme
}: TopNavProps) => {
  const appWindow = !IS_MOBILE ? getCurrentWindow() : null;
  const navRef = useRef<HTMLElement>(null);
  const stateUpdateTimeoutRef = useRef<NodeJS.Timeout>();

  const TABS = [
    { id: 'FAVORITES', label: 'Favourites' },
    { id: 'PLAYLIST_GALLERY', label: 'Playlists' },
    { id: 'ALL', label: 'Tracks' },
    { id: 'ALBUMS', label: 'Albums' }, // FIXED
    { id: 'TOPTRACKS', label: 'Artists' }
  ];

  // ====================================================================
  // THE 60FPS PHYSICS ENGINE: Continuous Scaling & Opacity
  // ====================================================================
  const updateScales = useCallback(() => {
    if (!navRef.current || !IS_MOBILE) return;
    const activeId = currentView.startsWith('PLAYLIST_') ? 'PLAYLIST_GALLERY' : 
                     currentView.startsWith('ALBUM_') ? 'ALBUMS' : currentView;
    const container = navRef.current;
    
    const centerLine = container.scrollLeft + container.clientWidth / 2;
    // Hard limit: If a button is 140px away from the center, it shrinks to its minimum size.
    const maxDist = 140; 

    let closestView: string | null = null;
    let minDiff = Infinity;

    Array.from(container.children).forEach((child) => {
      if (child.tagName === 'BUTTON') {
        const el = child as HTMLElement;
        const elCenter = el.offsetLeft + el.offsetWidth / 2;
        const distance = Math.abs(centerLine - elCenter);
        
        let ratio = 1 - (distance / maxDist);
        if (ratio < 0) ratio = 0;
        
        // Smooth scaling curve
        const easeRatio = ratio * (2 - ratio); 
        const scale = 0.85 + (easeRatio * 0.35); // 0.85x min, 1.20x max
        const opacity = 0.4 + (easeRatio * 0.6); // 40% min, 100% max

        // CRITICAL: Force the style with 'important' to bypass your broken CSS file
        el.style.setProperty('transform', `scale(${scale})`, 'important');
        el.style.setProperty('opacity', opacity.toString(), 'important');

        if (distance < minDiff) {
          minDiff = distance;
          closestView = el.dataset.view || null;
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
    const activeId = currentView.startsWith('PLAYLIST_') ? 'PLAYLIST_GALLERY' : currentView;
    const activeBtn = navRef.current.querySelector(`button[data-view="${activeId}"]`) as HTMLElement;
    if (!activeBtn) return;

    const container = navRef.current;
    const center = container.scrollLeft + container.clientWidth / 2;
    const btnCenter = activeBtn.offsetLeft + activeBtn.offsetWidth / 2;

    // If the button is physically further than 20px from the center, scroll it.
    // If it's closer than 20px, it means the user's finger dragged it there. Leave it alone.
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
            <button className="win-btn close" onClick={() => appWindow.close()}>✕</button>
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
            {/* THE NUCLEAR BUTTON */}
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