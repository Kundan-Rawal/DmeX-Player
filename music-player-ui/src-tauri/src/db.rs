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
    pub date_added: Option<i64>,
    pub last_played: Option<i64>,
    pub detected_cutoff_hz: Option<f32>,
    pub source_quality: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CustomPlaylist {
    pub id: String,
    pub name: String,
    pub track_paths: Vec<String>,
}

pub fn upsert_track(conn: &Connection, track: &Track) -> Result<()> {
    let date_added = track.date_added.unwrap_or_else(|| {
        #[cfg(target_os = "android")]
        { return std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0); }
        #[cfg(all(unix, not(target_os = "android")))]
        {
            use std::os::unix::fs::MetadataExt;
            if let Ok(m) = std::fs::metadata(&track.path) {
                return m.ctime() as i64;
            }
        }
        
        std::fs::metadata(&track.path)
            .and_then(|m| m.created().or_else(|_| m.modified()))
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    });

    conn.execute(
        "INSERT INTO tracks (
            path, name, artist, album, year, quality, duration, 
            profile, metadataLoaded, genre, isFavorite, playCount, 
            totalSecondsListened, thumb, dateAdded
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
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
            &track.thumb, date_added
        ),
    )?;
    Ok(())
}

pub fn get_all_tracks(conn: &Connection) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT path, name, artist, album, year, quality, duration, profile, metadataLoaded, genre, isFavorite, playCount, totalSecondsListened, thumb, dateAdded, detected_cutoff_hz, source_quality, lastPlayed
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
            date_added: row.get(14).unwrap_or(Some(0)),
            detected_cutoff_hz: row.get(15).unwrap_or(None),
            source_quality: row.get(16).unwrap_or(None),
            last_played: row.get(17).unwrap_or(None),
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
    conn.execute("UPDATE tracks SET totalSecondsListened = COALESCE(totalSecondsListened, 0) + MAX(?1, 0) WHERE path = ?2", (seconds, path))?;
    Ok(())
}

pub fn record_play(conn: &Connection, path: &str) -> Result<()> {
    conn.execute("UPDATE tracks SET playCount = COALESCE(playCount, 0) + 1, lastPlayed = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE path = ?1", [path])?;
    Ok(())
}

pub fn update_profile(conn: &Connection, path: &str, profile: &str) -> Result<()> {
    conn.execute("UPDATE tracks SET profile = ?1 WHERE path = ?2", (profile, path))?;
    Ok(())
}

pub fn save_playlist(conn: &Connection, playlist: &CustomPlaylist) -> Result<()> {
    let transaction = conn.unchecked_transaction()?;
    transaction.execute("INSERT INTO playlists (id, name) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET name = excluded.name", (&playlist.id, &playlist.name))?;
    transaction.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", [&playlist.id])?;
    for (i, path) in playlist.track_paths.iter().enumerate() {
        transaction.execute("INSERT INTO playlist_tracks (playlist_id, track_path, position) VALUES (?1, ?2, ?3)", (&playlist.id, path, i))?;
    }
    transaction.commit()?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE tracks (path TEXT PRIMARY KEY, name TEXT, artist TEXT, album TEXT, year TEXT, quality TEXT, duration REAL, profile TEXT, metadataLoaded BOOLEAN, genre TEXT, isFavorite BOOLEAN, playCount INTEGER, totalSecondsListened INTEGER, thumb TEXT, dateAdded INTEGER, detected_cutoff_hz REAL, source_quality TEXT, lastPlayed INTEGER);
            CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE playlist_tracks (playlist_id TEXT, track_path TEXT, position INTEGER, PRIMARY KEY(playlist_id, track_path));").unwrap();
        conn
    }

    fn track() -> Track {
        serde_json::from_value(serde_json::json!({"path":"fixture.flac", "name":"Song", "artist":"Artist", "album":"Album", "duration":123.0})).unwrap()
    }

    #[test]
    fn insert_and_metadata_rescan_preserve_user_history() {
        let conn = database();
        let mut t = track();
        upsert_track(&conn, &t).unwrap();
        toggle_favorite(&conn, &t.path, true).unwrap();
        update_play_stats(&conn, &t.path, 31).unwrap();
        record_play(&conn, &t.path).unwrap();
        update_profile(&conn, &t.path, "CLASSICAL").unwrap();
        let original_date = get_all_tracks(&conn).unwrap()[0].date_added;
        t.name = "Corrected Title".into(); t.metadata_loaded = Some(true);
        upsert_track(&conn, &t).unwrap();
        let tracks = get_all_tracks(&conn).unwrap();
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].name, "Corrected Title");
        assert_eq!(tracks[0].is_favorite, Some(true));
        assert_eq!(tracks[0].total_seconds_listened, Some(31));
        assert_eq!(tracks[0].play_count, Some(1));
        assert_eq!(tracks[0].profile.as_deref(), Some("CLASSICAL"));
        assert_eq!(tracks[0].date_added, original_date);
    }

    #[test]
    fn listening_flush_does_not_count_pause_as_a_new_play() {
        let conn = database(); let t = track(); upsert_track(&conn, &t).unwrap();
        for seconds in [15, 15, 3, -100] { update_play_stats(&conn, &t.path, seconds).unwrap(); }
        let tracks = get_all_tracks(&conn).unwrap();
        assert_eq!(tracks[0].total_seconds_listened, Some(33));
        assert_eq!(tracks[0].play_count, Some(0));
    }

    #[test]
    fn playlist_roundtrip_keeps_order_and_removals() {
        let conn = database();
        let mut playlist = CustomPlaylist { id:"p".into(), name:"Playlist".into(), track_paths:vec!["b".into(),"a".into()] };
        save_playlist(&conn, &playlist).unwrap();
        assert_eq!(get_playlists(&conn).unwrap()[0].track_paths, playlist.track_paths);
        playlist.track_paths = vec!["a".into()]; save_playlist(&conn, &playlist).unwrap();
        assert_eq!(get_playlists(&conn).unwrap()[0].track_paths, vec!["a"]);
    }

    #[test]
    fn playlist_failure_restores_previous_name_and_items() {
        let conn = database();
        let original = CustomPlaylist { id: "p".into(), name: "Original".into(), track_paths: vec!["a".into(), "b".into()] };
        save_playlist(&conn, &original).unwrap();
        let invalid = CustomPlaylist { id: "p".into(), name: "Changed".into(), track_paths: vec!["duplicate".into(), "duplicate".into()] };
        assert!(save_playlist(&conn, &invalid).is_err());
        let saved = get_playlists(&conn).unwrap();
        assert_eq!(saved[0].name, original.name);
        assert_eq!(saved[0].track_paths, original.track_paths);
    }
}
