import React, { useState } from 'react';
import { Search, Play, Download, Cloud } from 'lucide-react';
import { Track } from '../types';

interface CloudFetchViewProps {
  onPlayCloudTrack: (trackData: any) => void;
}

export const CloudFetchView = ({ onPlayCloudTrack }: CloudFetchViewProps) => {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);

  // Simple stub for fetching from saavn.dev
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setIsLoading(true);
    try {
      // Hit the user-provided API
      const response = await fetch(`https://saavan-api-psi.vercel.app/api/search/songs?query=${encodeURIComponent(query)}`);
      const data = await response.json();
      
      // Robust parsing: try both /api/search/songs and /api/search structures
      let parsedResults = [];
      if (data && data.success && data.data) {
        if (Array.isArray(data.data.results)) {
          parsedResults = data.data.results;
        } else if (data.data.songs && Array.isArray(data.data.songs.results)) {
          parsedResults = data.data.songs.results;
        }
      }
      setResults(parsedResults);
    } catch (err) {
      console.error("Failed to fetch cloud songs:", err);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="samsung-content-pad" style={{ display: 'flex', flexDirection: 'column', gap: '24px', height: '100%', overflowY: 'auto' }}>
      
      {/* Search Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', marginTop: '24px' }}>
        <div style={{
          width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff'
        }}>
          <Cloud size={32} />
        </div>
        <h2 style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#ffffff' }}>Cloud Discover</h2>
        <p style={{ margin: 0, color: 'rgba(255,255,255,0.6)', fontSize: '15px', maxWidth: '400px', textAlign: 'center' }}>
          Search millions of songs directly from Saavn and stream them natively through the DmeX audio engine.
        </p>

        <form onSubmit={handleSearch} style={{ width: '100%', maxWidth: '600px', position: 'relative', marginTop: '16px' }}>
          <Search size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.5)' }} />
          <input
            type="text"
            placeholder="Search for songs, artists, or paste a link..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '16px 16px 16px 48px',
              borderRadius: '24px',
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(15,15,15,0.4)',
              color: '#ffffff',
              fontSize: '16px',
              backdropFilter: 'blur(20px)',
              outline: 'none'
            }}
          />
          <button 
            type="submit" 
            disabled={isLoading || !query.trim()}
            style={{
              position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
              background: 'var(--theme-color, #c8222a)', color: '#fff', border: 'none',
              padding: '8px 16px', borderRadius: '16px', fontWeight: 600, cursor: 'pointer',
              opacity: (isLoading || !query.trim()) ? 0.5 : 1
            }}
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {/* Results Grid */}
      {results.length > 0 && (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
          gap: '16px',
          paddingBottom: '120px'
        }}>
          {results.map((song: any) => (
            <div key={song.id} style={{
              display: 'flex', gap: '16px', padding: '12px', borderRadius: '16px',
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
              alignItems: 'center'
            }}>
              <img 
                src={song.image?.[2]?.url || song.image?.[1]?.url || song.image?.[0]?.url} 
                alt={song.name}
                style={{ width: '64px', height: '64px', borderRadius: '12px', objectFit: 'cover' }}
              />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ color: '#fff', fontSize: '15px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {/* Clean up HTML entities from JioSaavn API */}
                  {song.name.replace(/&quot;/g, '"').replace(/&amp;/g, '&')}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {song.artists?.primary?.map((a:any) => a.name).join(', ') || 'Unknown Artist'}
                </div>
              </div>
              
              <button 
                onClick={() => onPlayCloudTrack(song)}
                className="samsung-icon-btn" 
                style={{ background: 'var(--theme-color, #c8222a)', color: '#fff' }}
              >
                <Play size={18} fill="currentColor" />
              </button>
            </div>
          ))}
        </div>
      )}

    </div>
  );
};
