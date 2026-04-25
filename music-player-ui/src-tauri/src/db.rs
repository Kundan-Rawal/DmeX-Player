use rusqlite::{Connection, Result};
use std::fs;
use std::path::PathBuf;

// Updated Track struct to map directly to your React state
#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub path: String,
    #[serde(rename = "name")] // Maps Rust 'title' to React 'name'
    pub title: String,         
    pub artist: String,
    pub album: String,
    pub genre: String,
    pub duration: f64,
    pub is_favorite: bool,
    pub play_count: i32,
    pub total_seconds_listened: i32,
    pub profile: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CustomPlaylist {
    pub id: String,
    pub name: String,
    pub track_paths: Vec<String>,
}

pub fn init_db(app_data_dir: PathBuf) -> Result<Connection> {
    if !app_data_dir.exists() {
        fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");
    }

    let db_path = app_data_dir.join("dmex_library.db");
    let conn = Connection::open(db_path)?;

    // 1. The Main Tracks Table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tracks (
            id TEXT PRIMARY KEY,
            path TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            artist TEXT NOT NULL,
            album TEXT NOT NULL,
            genre TEXT NOT NULL,
            duration REAL NOT NULL
        )",
        [],
    )?;

    // Failsafe: Add the new columns to the existing DB without crashing
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN is_favorite BOOLEAN DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN play_count INTEGER DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN total_seconds_listened INTEGER DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN profile TEXT", []);

    conn.execute("CREATE INDEX IF NOT EXISTS idx_artist ON tracks (artist)", [])?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_album ON tracks (album)", [])?;

    // 2. Playlists Relational Tables
    conn.execute(
        "CREATE TABLE IF NOT EXISTS playlists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id TEXT,
            track_path TEXT,
            position INTEGER,
            PRIMARY KEY (playlist_id, track_path)
        )",
        [],
    )?;

    Ok(conn)
}

pub fn upsert_track(conn: &Connection, track: &Track) -> Result<()> {
    conn.execute(
        "INSERT INTO tracks (id, path, title, artist, album, genre, duration)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(path) DO UPDATE SET
            title = excluded.title,
            artist = excluded.artist,
            album = excluded.album,
            genre = excluded.genre,
            duration = excluded.duration",
            // Notice we do NOT overwrite favorites, play counts, or profiles here!
        (
            &track.id, &track.path, &track.title, &track.artist,
            &track.album, &track.genre, track.duration,
        ),
    )?;
    Ok(())
}

pub fn toggle_favorite(conn: &Connection, path: &str, is_favorite: bool) -> Result<()> {
    conn.execute("UPDATE tracks SET is_favorite = ?1 WHERE path = ?2", (is_favorite, path))?;
    Ok(())
}

pub fn update_play_stats(conn: &Connection, path: &str, seconds: i32) -> Result<()> {
    conn.execute("UPDATE tracks SET play_count = play_count + 1, total_seconds_listened = total_seconds_listened + ?1 WHERE path = ?2", (seconds, path))?;
    Ok(())
}

pub fn update_profile(conn: &Connection, path: &str, profile: &str) -> Result<()> {
    conn.execute("UPDATE tracks SET profile = ?1 WHERE path = ?2", (profile, path))?;
    Ok(())
}

pub fn save_playlist(conn: &Connection, playlist: &CustomPlaylist) -> Result<()> {
    conn.execute("INSERT OR REPLACE INTO playlists (id, name) VALUES (?1, ?2)", (&playlist.id, &playlist.name))?;
    conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", [&playlist.id])?;
    for (i, path) in playlist.track_paths.iter().enumerate() {
        conn.execute("INSERT INTO playlist_tracks (playlist_id, track_path, position) VALUES (?1, ?2, ?3)", (&playlist.id, path, i))?;
    }
    Ok(())
}

pub fn get_playlists(conn: &Connection) -> Result<Vec<CustomPlaylist>> {
    let mut stmt = conn.prepare("SELECT id, name FROM playlists")?;
    let pl_iter = stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let name: String = row.get(1)?;
        
        let mut t_stmt = conn.prepare("SELECT track_path FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position")?;
        let t_iter = t_stmt.query_map([&id], |t_row| t_row.get(0))?;
        let mut track_paths = Vec::new();
        for t in t_iter { track_paths.push(t?); }
        
        Ok(CustomPlaylist { id, name, track_paths })
    })?;

    let mut playlists = Vec::new();
    for pl in pl_iter { playlists.push(pl?); }
    Ok(playlists)
}

pub fn get_all_tracks(conn: &Connection) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare("SELECT id, path, title, artist, album, genre, duration, is_favorite, play_count, total_seconds_listened, profile FROM tracks ORDER BY artist, album, title")?;
    
    let track_iter = stmt.query_map([], |row| {
        Ok(Track {
            id: row.get(0)?, path: row.get(1)?, title: row.get(2)?,
            artist: row.get(3)?, album: row.get(4)?, genre: row.get(5)?, duration: row.get(6)?,
            is_favorite: row.get(7).unwrap_or(false),
            play_count: row.get(8).unwrap_or(0),
            total_seconds_listened: row.get(9).unwrap_or(0),
            profile: row.get(10).unwrap_or(None),
        })
    })?;

    let mut tracks = Vec::new();
    for track in track_iter { tracks.push(track?); }
    Ok(tracks)
}