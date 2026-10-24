package com.dmex.player

import android.Manifest
import android.app.Activity
import android.content.ContentUris
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.media.MediaMetadataRetriever
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.util.concurrent.Executors
import java.security.MessageDigest

@InvokeArg
class MusicScanArgs { var folderPath: String = "ALL" }

@InvokeArg
class MusicMetadataArgs { lateinit var path: String }

@TauriPlugin
class MusicLibraryPlugin(private val activity: Activity) : Plugin(activity) {
    private val worker = Executors.newSingleThreadExecutor()
    private val extensions = setOf("mp3", "mp2", "mp1", "wav", "wave", "flac", "m4a", "m4b", "mp4", "aac", "ogg", "oga", "aif", "aiff", "aifc", "caf")

    @Command
    fun extractMetadata(invoke: Invoke) {
        val args = invoke.parseArgs(MusicMetadataArgs::class.java)
        worker.execute {
            val reader = MediaMetadataRetriever()
            try {
                if (args.path.startsWith("content://")) reader.setDataSource(activity, Uri.parse(args.path)) else reader.setDataSource(args.path)
                val result = JSObject()
                    .put("title", reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE))
                    .put("artist", reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST))
                    .put("album", reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM))
                    .put("year", reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR))
                    .put("genre", reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_GENRE))
                    .put("duration", (reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0) / 1000.0)
                reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toLongOrNull()?.let {
                    result.put("quality", "${it / 1000} kbps")
                }
                reader.embeddedPicture?.takeIf { it.isNotEmpty() && it.size <= 20 * 1024 * 1024 }?.let { bytes ->
                    val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
                    val extension = if (bytes.size > 4 && bytes[0] == 0x89.toByte() && bytes[1] == 0x50.toByte()) "png" else "jpg"
                    val directory = File(activity.filesDir, "art_cache").apply { mkdirs() }
                    val image = File(directory, "native_$hash.$extension")
                    if (!image.exists() || image.length() != bytes.size.toLong()) image.writeBytes(bytes)
                    result.put("artPath", image.absolutePath)
                }
                invoke.resolve(result)
            } catch (error: Exception) { invoke.reject("Android metadata reader could not read this source: ${error.message}") }
            finally { reader.release() }
        }
    }

    @Command
    fun pickFolder(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        startActivityForResult(invoke, intent, "folderSelected")
    }

    @ActivityCallback
    fun folderSelected(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolve(JSObject().put("path", null))
            return
        }
        try {
            activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            invoke.resolve(JSObject().put("path", uri.toString()))
        } catch (error: Exception) { invoke.reject("Cannot retain folder access: ${error.message}") }
    }

    @Command
    fun scan(invoke: Invoke) {
        val args = invoke.parseArgs(MusicScanArgs::class.java)
        worker.execute {
            try {
                val tracks = if (args.folderPath.startsWith("content://")) scanTree(Uri.parse(args.folderPath)) else scanMedia(args.folderPath)
                invoke.resolve(JSObject().put("tracks", JSArray(tracks.distinctBy { it.getString("file_path") })))
            } catch (error: Exception) { invoke.reject("Music scan failed: ${error.message}") }
        }
    }

    private fun entry(path: String, title: String, artist: String = "Unknown Artist", album: String = "Unknown Album", duration: Long = 0): JSObject =
        JSObject().put("file_path", path).put("title", title).put("artist", artist).put("album", album).put("duration", duration / 1000.0)

    private fun scanMedia(root: String): List<JSObject> {
        val permission = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE
        if (ContextCompat.checkSelfPermission(activity, permission) != PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("Allow music/audio access in Android Settings, or use Custom to select a folder.")
        }
        val tracks = mutableListOf<JSObject>()
        val uri = if (Build.VERSION.SDK_INT >= 29) MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) else MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        val columns = arrayOf(MediaStore.Audio.Media._ID, MediaStore.Audio.Media.DATA, MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST, MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.DURATION)
        activity.contentResolver.query(uri, columns, null, null, null)?.use { cursor ->
            while (cursor.moveToNext()) {
                val path = cursor.getString(1) ?: ""
                if (root != "ALL" && path != root && !path.startsWith(root.trimEnd('/') + "/")) continue
                val name = cursor.getString(2) ?: path.substringAfterLast('/')
                if (name.substringAfterLast('.', "").lowercase() !in extensions) continue
                val readable = path.isNotEmpty() && File(path).canRead()
                val source = if (readable) path else ContentUris.withAppendedId(uri, cursor.getLong(0)).toString()
                tracks.add(entry(source, cursor.getString(3) ?: name.substringBeforeLast('.'),
                    cursor.getString(4)?.takeUnless { it == "<unknown>" } ?: "Unknown Artist",
                    cursor.getString(5)?.takeUnless { it == "<unknown>" } ?: "Unknown Album", cursor.getLong(6)))
            }
        }
        // Include unindexed audio without restricting discovery to IS_MUSIC (which excludes many WAV files).
        val directory = File(if (root == "ALL") "/storage/emulated/0" else root)
        if (directory.isDirectory) directory.walkTopDown().onEnter { it.name != "Android" && !it.name.startsWith('.') }.forEach { file ->
            if (file.isFile && file.extension.lowercase() in extensions && file.canRead()) {
                tracks.add(entry(file.absolutePath, file.nameWithoutExtension))
            }
        }
        return tracks
    }

    private fun scanTree(tree: Uri): List<JSObject> {
        val tracks = mutableListOf<JSObject>()
        val pending = ArrayDeque<String>()
        val visited = HashSet<String>()
        pending.add(DocumentsContract.getTreeDocumentId(tree))
        while (pending.isNotEmpty()) {
            val parent = pending.removeFirst()
            if (!visited.add(parent)) continue
            val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent)
            activity.contentResolver.query(children, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE), null, null, null)?.use { cursor ->
                while (cursor.moveToNext()) {
                    val id = cursor.getString(0)
                    val name = cursor.getString(1) ?: ""
                    if (cursor.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR) pending.add(id)
                    else if (name.substringAfterLast('.', "").lowercase() in extensions) {
                        val uri = DocumentsContract.buildDocumentUriUsingTree(tree, id)
                        val local = if (id.startsWith("primary:")) File("/storage/emulated/0", id.removePrefix("primary:")) else null
                        tracks.add(entry(if (local?.canRead() == true) local.absolutePath else uri.toString(), name.substringBeforeLast('.')))
                    }
                }
            }
        }
        return tracks
    }
}
