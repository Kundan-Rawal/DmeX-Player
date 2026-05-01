use rusqlite::{Connection, Result};

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub path: String,
    pub name: String,
    pub artist: String,
    pub album: String,
    pub year: Option<String>,
    pub quality: Option<String>,
    pub duration: f64,
    pub profile: Option<String>,
    pub metadata_loaded: Option<bool>,
    pub genre: Option<String>,
    pub is_favorite: Option<bool>,
    pub play_count: Option<i32>,
    pub total_seconds_listened: Option<i32>,
    pub thumb: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CustomPlaylist {
    pub id: String,
    pub name: String,
    pub track_paths: Vec<String>,
}

pub fn upsert_track(conn: &Connection, track: &Track) -> Result<()> {
    conn.execute(
        "INSERT INTO tracks (
            path, name, artist, album, year, quality, duration, 
            profile, metadataLoaded, genre, isFavorite, playCount, 
            totalSecondsListened, thumb
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        ON CONFLICT(path) DO UPDATE SET
            name = excluded.name,
            artist = excluded.artist,
            album = excluded.album,
            year = excluded.year,
            quality = excluded.quality,
            duration = excluded.duration,
            metadataLoaded = excluded.metadataLoaded,
            genre = excluded.genre,
            thumb = excluded.thumb",
        (
            &track.path, &track.name, &track.artist, &track.album,
            &track.year, &track.quality, track.duration,
            &track.profile, track.metadata_loaded.unwrap_or(false),
            &track.genre, track.is_favorite.unwrap_or(false),
            track.play_count.unwrap_or(0),
            track.total_seconds_listened.unwrap_or(0),
            &track.thumb
        ),
    )?;
    Ok(())
}

pub fn get_all_tracks(conn: &Connection) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT path, name, artist, album, year, quality, duration, profile, metadataLoaded, genre, isFavorite, playCount, totalSecondsListened, thumb 
         FROM tracks ORDER BY artist, album, name"
    )?;
    
    let track_iter = stmt.query_map([], |row| {
        Ok(Track {
            path: row.get(0)?,
            name: row.get(1)?,
            artist: row.get(2)?,
            album: row.get(3)?,
            year: row.get(4).unwrap_or(None),
            quality: row.get(5).unwrap_or(None),
            duration: row.get(6)?,
            profile: row.get(7).unwrap_or(None),
            metadata_loaded: row.get(8).unwrap_or(Some(false)),
            genre: row.get(9).unwrap_or(None),
            is_favorite: row.get(10).unwrap_or(Some(false)),
            play_count: row.get(11).unwrap_or(Some(0)),
            total_seconds_listened: row.get(12).unwrap_or(Some(0)),
            thumb: row.get(13).unwrap_or(None),
        })
    })?;

    let mut tracks = Vec::new();
    for track in track_iter { tracks.push(track?); }
    Ok(tracks)
}

pub fn toggle_favorite(conn: &Connection, path: &str, is_favorite: bool) -> Result<()> {
    conn.execute("UPDATE tracks SET isFavorite = ?1 WHERE path = ?2", (is_favorite, path))?;
    Ok(())
}

pub fn update_play_stats(conn: &Connection, path: &str, seconds: i32) -> Result<()> {
    conn.execute("UPDATE tracks SET playCount = playCount + 1, totalSecondsListened = totalSecondsListened + ?1 WHERE path = ?2", (seconds, path))?;
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