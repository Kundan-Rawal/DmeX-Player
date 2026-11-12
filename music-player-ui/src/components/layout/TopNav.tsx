import { useRef, useEffect, useCallback, useState } from 'react';
import { NavView, IS_MOBILE } from '../../types'; 
import { X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './TopNav.css';
import { BrandMark } from '../common/BrandMark';
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
    { id: 'CLOUD_FETCH', label: 'Discover' },
    { id: 'FAVOURITES', label: 'Favourites' },
    { id: 'PLAYLIST_GALLERY', label: 'Playlists' },
    { id: 'ALL', label: 'Tracks' },
    { id: 'ALBUMS', label: 'Albums' }, // FIXED
    { id: 'ARTIST', label: 'Artists' }
  ];

  const normalizedView = (view: string) => view.startsWith('PLAYLIST_') ? 'PLAYLIST_GALLERY'
    : view.startsWith('ALBUM_') ? 'ALBUMS' : view.startsWith('ARTIST_') ? 'ARTIST' : view;
  const currentViewRef = useRef(currentView);
  currentViewRef.current = currentView;
  const programmaticScroll = useRef(false);
  const paintRef = useRef<number | undefined>(undefined);

  const updateScales = useCallback(() => {
    const nav = navRef.current;
    if (!nav || !IS_MOBILE) return;
    const center = nav.getBoundingClientRect().left + nav.clientWidth / 2;
    const activeId = normalizedView(currentViewRef.current);
    for (const button of nav.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
      const rect = button.getBoundingClientRect();
      const distance = Math.abs(center - rect.left - rect.width / 2);
      const ratio = Math.max(0, 1 - distance / 140);
      const eased = ratio * (2 - ratio);
      const active = button.dataset.view === activeId;
      button.style.setProperty('transform', `scale(${(active ? 1 : .85) + eased * .35})`, 'important');
      button.style.setProperty('opacity', String(Math.min(1, (active ? .7 : .4) + eased * .6)), 'important');
    }
  }, []);

  const centerTab = useCallback((view: string, behavior: ScrollBehavior = 'smooth') => {
    const nav = navRef.current;
    const button = nav?.querySelector<HTMLButtonElement>(`button[data-view="${normalizedView(view)}"]`);
    if (!nav || !button) return;
    const navRect = nav.getBoundingClientRect(), rect = button.getBoundingClientRect();
    const distance = rect.left + rect.width / 2 - navRect.left - nav.clientWidth / 2;
    if (Math.abs(distance) < 1) { updateScales(); return; }
    programmaticScroll.current = true;
    nav.scrollTo({ left: nav.scrollLeft + distance, behavior });
  }, [updateScales]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || !IS_MOBILE) return;
    const settle = () => {
      updateScales();
      if (programmaticScroll.current) { programmaticScroll.current = false; return; }
      const center = nav.getBoundingClientRect().left + nav.clientWidth / 2;
      let closest: HTMLButtonElement | null = null, distance = Infinity;
      for (const button of nav.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
        const rect = button.getBoundingClientRect();
        const diff = Math.abs(rect.left + rect.width / 2 - center);
        if (diff < distance) { closest = button; distance = diff; }
      }
      const next = closest?.dataset.view;
      if (next && next !== normalizedView(currentViewRef.current)) setCurrentView(next as NavView);
    };
    const scroll = () => {
      if (paintRef.current === undefined) paintRef.current = requestAnimationFrame(() => {
        paintRef.current = undefined; updateScales();
      });
      window.clearTimeout(stateUpdateTimeoutRef.current);
      stateUpdateTimeoutRef.current = window.setTimeout(settle, 160);
    };
    const userScroll = () => { programmaticScroll.current = false; };
    const resize = () => {
      const buttons = nav.querySelectorAll<HTMLButtonElement>('button[data-view]');
      const spacers = nav.querySelectorAll<HTMLElement>('.nav-spacer');
      const gap = parseFloat(getComputedStyle(nav).columnGap) || 0;
      if (buttons.length && spacers.length === 2) {
        spacers[0].style.width = Math.max(0, nav.clientWidth / 2 - buttons[0].offsetWidth / 2 - gap) + 'px';
        spacers[1].style.width = Math.max(0, nav.clientWidth / 2 - buttons[buttons.length - 1].offsetWidth / 2 - gap) + 'px';
      }
      centerTab(currentViewRef.current, 'auto');
    };
    nav.addEventListener('scroll', scroll, { passive: true });
    nav.addEventListener('pointerdown', userScroll, { passive: true });
    nav.addEventListener('wheel', userScroll, { passive: true });
    const observer = new ResizeObserver(resize);
    observer.observe(nav);
    resize();
    return () => {
      observer.disconnect();
      nav.removeEventListener('scroll', scroll);
      nav.removeEventListener('pointerdown', userScroll);
      nav.removeEventListener('wheel', userScroll);
      if (paintRef.current !== undefined) cancelAnimationFrame(paintRef.current);
      paintRef.current = undefined;
      window.clearTimeout(stateUpdateTimeoutRef.current);
    };
  }, [centerTab, updateScales, setCurrentView]);

  useEffect(() => { if (IS_MOBILE) centerTab(currentView); }, [currentView, centerTab]);

  const handleTabClick = (view: string) => {
    setCurrentView(view as NavView);
    if (IS_MOBILE) centerTab(view);
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
            <BrandMark />
            <span className="app-brand-wordmark">
            <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>DmeX </span>
            <span style={{ fontWeight: 400, color: 'var(--text-primary)' }}>Player</span>
            </span>
          </div>

          <div className="samsung-actions">
            {IS_ANDROID ? (
              /* ============================================================== */
              /* ANDROID LAYOUT: Search Icon + 3-Dot Kebab Menu                 */
              /* ============================================================== */
              <>
                <button className="samsung-icon-btn" aria-label="Search" title="Search" onClick={() => setMobileSearchOpen(!mobileSearchOpen)}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                </button>
                
                <div style={{ position: 'relative' }}>
                  <button className="samsung-icon-btn" aria-label="Library options" onClick={() => setIsKebabOpen(!isKebabOpen)}>
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
                        
                        <button disabled={isLoading} onClick={() => { handleAddFolder(); setIsKebabOpen(false); }} style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', background: 'transparent', border: 'none', color: '#ffffff', fontSize: '15px', fontWeight: 600, cursor: 'pointer', borderRadius: '8px' }}>
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
                <button className="samsung-icon-btn" aria-label="Clear Library" title="Clear Library" onClick={handleClearLibrary} disabled={isLoading} style={{ color: '#e83040' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
                <button className="samsung-icon-btn" aria-label="Add Folder" title="Add Folder" onClick={handleAddFolder} disabled={isLoading}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                </button>
                <button className="samsung-icon-btn" aria-label="Search" title="Search" onClick={() => setMobileSearchOpen(!mobileSearchOpen)}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                </button>
                <button className="samsung-icon-btn" aria-label="Toggle theme" title="Toggle theme" onClick={toggleTheme}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                </button>
                <button className="samsung-icon-btn" aria-label="Settings" title="Settings" onClick={onOpenSettings}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                </button>
              </>
            )}
          </div>
        </header>

        <nav className={'samsung-nav-tabs' + (IS_MOBILE ? ' mobile-scroll-nav' : '')} data-tauri-drag-region={IS_MOBILE ? undefined : 'true'} ref={navRef} aria-label="Library views">
          <div className="nav-spacer" />
          {TABS.map(tab => {
            const isActive = currentView === tab.id || 
                             (tab.id === 'PLAYLIST_GALLERY' && currentView.startsWith('PLAYLIST_')) ||
                             (tab.id === 'ALBUMS' && currentView.startsWith('ALBUM_'));
            return (
              <button 
                key={tab.id} data-view={tab.id}
                className={isActive ? 'active' : ''}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => handleTabClick(tab.id)}
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
