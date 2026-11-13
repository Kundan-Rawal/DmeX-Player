package com.dmex.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent
import androidx.core.content.ContextCompat
import org.json.JSONObject

class PlaybackService : Service() {
    companion object {
        @Volatile var instance: PlaybackService? = null
            private set
        private const val CHANNEL = "dmex_playback"
        private const val NOTIFICATION = 42
    }
    private lateinit var session: MediaSession
    private lateinit var audio: AudioManager
    private val handler = Handler(Looper.getMainLooper())
    private val clicks = HeadsetClicks()
    private var state = JSONObject()
    private var foreground = false
    private var focused = false
    private var focusRequest: AudioFocusRequest? = null
    private var lastPlaying = false
    private var lastPosition = 0L
    private var lastUpdate = SystemClock.elapsedRealtime()
    private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
            focused = false
            clearClicks()
            NativeMediaBridge.send(2)
        }
    }
    private val clickAction = Runnable { dispatch(clicks.takeAction()) }
    private val noisy = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) { clearClicks(); NativeMediaBridge.send(7) }
        }
    }
    private val poll = object : Runnable {
        override fun run() {
            val playing = NativeMediaBridge.stateFlags() and 2 != 0
            if (playing != lastPlaying) {
                lastPosition = position()
                lastUpdate = SystemClock.elapsedRealtime()
                lastPlaying = playing
                publish()
            }
            handler.postDelayed(this, if (playing) 750 else 2000)
        }
    }
    override fun onCreate() {
        super.onCreate()
        instance = this
        audio = getSystemService(AudioManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Music playback", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null); enableVibration(false) })
        session = MediaSession(this, "DmeX Player")
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
        session.setPlaybackToLocal(attributes)
        session.setSessionActivity(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        session.setCallback(object : MediaSession.Callback() {
            override fun onPlay() = dispatch(1)
            override fun onPause() = dispatch(2)
            override fun onStop() = dispatch(6)
            override fun onSkipToNext() = dispatch(3)
            override fun onSkipToPrevious() = dispatch(4)
            override fun onSeekTo(pos: Long) = seek(pos)
            override fun onFastForward() = seek(position() + 10000)
            override fun onRewind() = seek(position() - 10000)
            override fun onMediaButtonEvent(intent: Intent): Boolean {
                val event = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
                    else @Suppress("DEPRECATION") intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
                return event?.let { handleMediaKey(it) } ?: false
            }
        }, handler)
        ContextCompat.registerReceiver(this, noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_EXPORTED)
        handler.post(poll)
    }
    fun handleMediaKey(event: KeyEvent): Boolean {
        val key = event.keyCode
        val action = when (key) {
            KeyEvent.KEYCODE_MEDIA_PLAY -> 1
            KeyEvent.KEYCODE_MEDIA_PAUSE -> 2
            KeyEvent.KEYCODE_MEDIA_STOP -> 6
            KeyEvent.KEYCODE_MEDIA_NEXT -> 3
            KeyEvent.KEYCODE_MEDIA_PREVIOUS -> 4
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> 8
            KeyEvent.KEYCODE_MEDIA_REWIND -> 9
            KeyEvent.KEYCODE_HEADSETHOOK, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> 0
            else -> return false
        }
        if (event.isCanceled) { clearClicks(); return true }
        if (action == 0) {
            if (event.action == KeyEvent.ACTION_UP && event.repeatCount == 0 && event.eventTime - event.downTime < 600) {
                handler.removeCallbacks(clickAction)
                if (clicks.add() == 3) clickAction.run() else handler.postDelayed(clickAction, 300)
            }
        } else if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            clearClicks()
            when (action) { 8 -> seek(position() + 10000); 9 -> seek(position() - 10000); else -> dispatch(action) }
        }
        return true
    }
    private fun clearClicks() { handler.removeCallbacks(clickAction); clicks.clear() }
    private fun requestFocus(): Boolean {
        if (focused) return true
        val result = if (Build.VERSION.SDK_INT >= 26) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener(focusListener, handler).build()
            focusRequest = request
            audio.requestAudioFocus(request)
        } else @Suppress("DEPRECATION") audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        focused = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        return focused
    }
    private fun dispatch(action: Int) {
        if (NativeMediaBridge.stateFlags() and 1 == 0) return
        val willPlay = action == 1 || action == 3 || action == 4 || action == 0 && NativeMediaBridge.stateFlags() and 2 == 0
        if (willPlay) { promote(); if (!requestFocus()) return }
        NativeMediaBridge.send(action)
        handler.removeCallbacks(poll); handler.postDelayed(poll, 80)
    }
    private fun seek(value: Long) {
        val duration = state.optLong("duration")
        val target = if (duration > 0) value.coerceIn(0, duration) else value.coerceAtLeast(0)
        NativeMediaBridge.send(5, target)
        lastPosition = target; lastUpdate = SystemClock.elapsedRealtime(); publish()
    }
    private fun position() = (lastPosition + if (lastPlaying) SystemClock.elapsedRealtime() - lastUpdate else 0).coerceAtLeast(0)
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        intent?.getStringExtra("state")?.let { raw ->
            state = JSONObject(raw)
            if (!state.optBoolean("hasTrack")) { session.isActive = false; stopSelf(); return START_NOT_STICKY }
            lastPosition = state.optLong("position").coerceAtLeast(0)
            lastUpdate = SystemClock.elapsedRealtime()
            lastPlaying = NativeMediaBridge.stateFlags() and 2 != 0
            session.isActive = state.optBoolean("hasTrack")
            session.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, state.optString("title"))
                .putString(MediaMetadata.METADATA_KEY_ARTIST, state.optString("artist"))
                .putLong(MediaMetadata.METADATA_KEY_DURATION, state.optLong("duration")).build())
            if (state.optBoolean("playing")) { promote(); if (!requestFocus()) NativeMediaBridge.send(2) }
            publish()
        }
        intent?.getIntExtra("action", -1)?.takeIf { it >= 0 }?.let { dispatch(it) }
        return START_NOT_STICKY
    }
    private fun notification(): Notification {
        fun action(id: Int, icon: Int, title: String): Notification.Action {
            val intent = Intent(this, PlaybackService::class.java).putExtra("action", id)
            return Notification.Action.Builder(icon, title, PendingIntent.getService(this, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)).build()
        }
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
        return builder.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle(state.optString("title", "DmeX Player"))
            .setContentText(state.optString("artist")).setContentIntent(session.controller.sessionActivity)
            .setVisibility(Notification.VISIBILITY_PUBLIC).setOnlyAlertOnce(true).setShowWhen(false).setOngoing(lastPlaying)
            .addAction(action(4, android.R.drawable.ic_media_previous, "Previous"))
            .addAction(action(if (lastPlaying) 2 else 1, if (lastPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play, if (lastPlaying) "Pause" else "Play"))
            .addAction(action(3, android.R.drawable.ic_media_next, "Next"))
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2)).build()
    }
    private fun promote() {
        if (foreground) return
        val notification = notification()
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(NOTIFICATION, notification)
        foreground = true
    }
    private fun publish() {
        val actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP or
            PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_FAST_FORWARD or PlaybackState.ACTION_REWIND or
            (if (state.optBoolean("canNext")) PlaybackState.ACTION_SKIP_TO_NEXT else 0L) or (if (state.optBoolean("canPrevious")) PlaybackState.ACTION_SKIP_TO_PREVIOUS else 0L)
        session.setPlaybackState(PlaybackState.Builder().setActions(actions)
            .setState(if (lastPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, position(), if (lastPlaying) 1f else 0f, SystemClock.elapsedRealtime()).build())
        if (!lastPlaying && foreground) {
            stopForeground(STOP_FOREGROUND_DETACH); foreground = false
            if (Build.VERSION.SDK_INT >= 26) focusRequest?.let { audio.abandonAudioFocusRequest(it) }
            else @Suppress("DEPRECATION") audio.abandonAudioFocus(focusListener)
            focused = false
        }
        if (lastPlaying) promote()
        if (state.optBoolean("hasTrack")) getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification())
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        unregisterReceiver(noisy)
        session.isActive = false; session.release()
        getSystemService(NotificationManager::class.java).cancel(NOTIFICATION)
        if (lastPlaying) NativeMediaBridge.send(2)
        if (Build.VERSION.SDK_INT >= 26) focusRequest?.let { audio.abandonAudioFocusRequest(it) }
        else @Suppress("DEPRECATION") audio.abandonAudioFocus(focusListener)
        instance = null
        super.onDestroy()
    }
}
