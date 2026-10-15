package com.t3tools.t3code.wear

import android.content.Context
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.util.Base64
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import java.util.UUID
import java.util.zip.GZIPInputStream

/** Mic and speaker stay on the watch; networking, credentials, tools and history belong to the phone. */
class VoiceSession(
    private val context: Context,
    private val api: T3Api,
    private val onTranscript: (VoiceHistoryLine) -> Unit,
    private val onHistory: (List<VoiceHistoryLine>) -> Unit,
    private val onError: (String) -> Unit,
    private val onState: (State) -> Unit,
) {
    enum class State { CONNECTING, LISTENING, SAVING, CLOSED, FAILED }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _state = MutableStateFlow(State.CONNECTING)
    val state: StateFlow<State> = _state
    private val sessionId = UUID.randomUUID().toString()
    private var environmentId = ""
    private var phoneId = ""
    private val messages = Wearable.getMessageClient(context)
    private val sampleRate = 24000
    private val chunkFrames = 2400
    private var recorder: AudioRecord? = null
    private var player: AudioTrack? = null
    private var recordJob: Job? = null
    private val playback = Channel<ByteArray>(100)
    private val transcripts = Channel<VoiceHistoryLine>(40)
    private val handled = mutableSetOf<String>()
    private val transcriptText = mutableMapOf<String, String>()
    private var historyJob: Job? = null
    private val outbox = VoiceOutbox(context)
    @Volatile private var saveFailed = false
    private var playedAudio = false
    @Volatile private var muted = false
    @Volatile private var closing = false
    @Volatile private var ready = false
    private var audioStarted = false
    private var itemId = ""
    private var playedMs = 0L
    private var itemStartMs = 0L
    private var itemPlayedMs = 0L

    private fun state(value: State) {
        _state.value = value
        scope.launch(Dispatchers.Main) { onState(value) }
    }
    private fun error(message: String) { scope.launch(Dispatchers.Main) { onError(message) } }

    private val listener = MessageClient.OnMessageReceivedListener { event ->
        if (event.path == "/t3code/voice/event" && event.sourceNodeId == phoneId) {
            try {
                val envelope = GZIPInputStream(event.data.inputStream()).bufferedReader().use { JSONObject(it.readText()) }
                if (envelope.optString("sessionId") == sessionId) handleMessage(envelope.getJSONObject("event"))
            } catch (_: Exception) { fail("Could not read the phone's voice response. Start again to reconnect.") }
        }
    }

    fun start() {
        state(State.CONNECTING)
        scope.launch {
            try {
                val nodes = Wearable.getNodeClient(context).connectedNodes.await()
                phoneId = (nodes.firstOrNull { it.isNearby } ?: nodes.firstOrNull())?.id
                    ?: throw IllegalStateException("Connect your watch to your phone, then start voice again.")
                messages.addListener(listener).await()
                outbox.flush(api)
                val response = api.startVoiceRelay(sessionId)
                environmentId = response.getString("environmentId")
                val history = response.optJSONArray("history")
                val lines = (0 until (history?.length() ?: 0)).map { index ->
                    val line = history!!.getJSONObject(index)
                    VoiceHistoryLine(line.getString("id"), line.getString("speaker"), line.getString("text"))
                }
                withContext(Dispatchers.Main) { onHistory(lines) }
                historyJob = scope.launch {
                    for (line in transcripts) {
                        try { outbox.flush(api) }
                        catch (_: Exception) {
                            saveFailed = true
                            error("Voice history is saved on your watch and waiting for your phone. Tap Talk to retry before switching devices.")
                            break
                        }
                    }
                }
                startAudioIfReady()
                scope.launch { while (isActive && !closing) { delay(10000); send(JSONObject().put("type", "t3.ping")) } }
            } catch (_: CancellationException) { }
            catch (cause: Exception) { fail(cause.message ?: "Could not start voice through your phone.") }
        }
    }

    private fun send(event: JSONObject) {
        if (closing || phoneId.isBlank()) return
        messages.sendMessage(phoneId, "/t3code/voice/audio", JSONObject().put("sessionId", sessionId)
            .put("event", event).toString().toByteArray(Charsets.UTF_8))
            .addOnFailureListener { if (!closing) fail("Your watch lost its phone connection. Tap Start to reconnect.") }
    }

    @Synchronized private fun startAudioIfReady() {
        if (closing || audioStarted || !ready || environmentId.isBlank()) return
        audioStarted = true
        try {
            startPlayback()
            scope.launch { for (bytes in playback) writePcm(bytes) }
            startRecording()
            state(State.LISTENING)
        } catch (cause: Exception) { fail(cause.message ?: "Could not open the watch microphone or speaker.") }
    }

    private fun transcript(data: JSONObject, speaker: String) {
        val text = data.optString("transcript").takeLast(16000)
        if (text.isBlank()) return
        val id = "$sessionId:$speaker:${data.optString("item_id", UUID.randomUUID().toString())}:${data.optInt("content_index", 0)}"
        synchronized(transcriptText) {
            if (transcriptText[id] == text) return
            transcriptText[id] = text
        }
        val line = VoiceHistoryLine(id, speaker, text)
        try { outbox.enqueue(environmentId, line) }
        catch (_: Exception) { saveFailed = true; error("Could not save this utterance on your watch.") }
        scope.launch(Dispatchers.Main) { onTranscript(line) }
        if (transcripts.trySend(line).isFailure) error("Voice history is waiting for your phone. End and reconnect before switching devices.")
    }

    private fun handleMessage(data: JSONObject) {
        if (closing) return
        when (data.optString("type")) {
            "session.updated" -> { ready = true; startAudioIfReady() }
            "error" -> fail(data.optJSONObject("error")?.optString("message") ?: "Voice provider error.")
            "response.output_audio.delta", "response.audio.delta" -> {
                val bytes = Base64.decode(data.optString("delta"), Base64.DEFAULT)
                val incoming = data.optString("item_id")
                if (incoming.isNotEmpty() && incoming != itemId) { itemId = incoming; itemStartMs = playedMs; itemPlayedMs = 0 }
                playedMs += bytes.size / 48
                itemPlayedMs += bytes.size / 48
                if (playback.trySend(bytes).isFailure) fail("Watch playback fell behind. Start voice again.")
            }
            "conversation.item.input_audio_transcription.completed" -> transcript(data, "You")
            "response.output_audio_transcript.done", "response.audio_transcript.done" -> transcript(data, "T3")
            "input_audio_buffer.speech_started" -> {
                if (itemId.isNotEmpty()) send(JSONObject().put("type", "conversation.item.truncate")
                    .put("item_id", itemId).put("content_index", 0).put("audio_end_ms", itemPlayedMs.coerceAtLeast(0)))
                while (playback.tryReceive().isSuccess) { }
                clearPlayback()
            }
            "response.done" -> {
                val response = data.optJSONObject("response") ?: return
                if (response.optString("status") != "completed") return
                val output = response.optJSONArray("output") ?: return
                val calls = (0 until output.length()).map { output.getJSONObject(it) }.filter {
                    it.optString("type") == "function_call" && synchronized(handled) { handled.add(it.optString("call_id")) }
                }
                if (calls.isNotEmpty()) scope.launch {
                    for (call in calls) {
                        val result = try { api.voiceTool(environmentId, call) }
                            catch (_: Exception) { JSONObject().put("ok", false).put("error", "Your phone could not complete this action. Check its connection before retrying.").toString() }
                        send(JSONObject().put("type", "conversation.item.create").put("item", JSONObject()
                            .put("type", "function_call_output").put("call_id", call.getString("call_id")).put("output", result)))
                    }
                    send(JSONObject().put("type", "response.create"))
                }
            }
        }
    }

    private fun fail(message: String) {
        if (closing) return
        error(message)
        end(State.FAILED)
    }
    fun close() { end(State.CLOSED) }
    @Synchronized private fun end(finalState: State) {
        if (closing) return
        send(JSONObject().put("type", "t3.close"))
        closing = true
        state(State.SAVING)
        messages.removeListener(listener)
        stopAudio()
        playback.close()
        transcripts.close()
        scope.launch {
            historyJob?.join()
            withContext(Dispatchers.Main) { val result = if (saveFailed) State.FAILED else finalState; onState(result); _state.value = result }
            scope.cancel()
        }
    }
    // ---- Microphone upload ----

    private fun startRecording() {
        val minBuffer = AudioRecord.getMinBufferSize(
            sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuffer, chunkFrames * 2 * 2))
        recorder = rec
        recordJob = scope.launch {
            try {
                rec.startRecording()
                android.util.Log.i("T3WatchVoice", "Microphone recording at 24000 Hz through paired phone")
                val pcm = ShortArray(chunkFrames)
                while (scope.isActive && !closing) {
                    val read = rec.read(pcm, 0, chunkFrames)
                    check(read >= 0) { "Watch microphone read failed: $read" }
                    if (read == 0) continue
                    if (muted) continue
                    if (closing) continue
                    val bytes = shortArrayToBytes(pcm, read)
                    val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                    val append = JSONObject()
                        .put("type", "input_audio_buffer.append")
                        .put("audio", b64)
                    send(append)
                }
            } catch (e: Exception) {
                if (!closing) fail("The watch microphone stopped. Start again to reconnect.")
            } finally {
                try { rec.stop() } catch (_: Exception) {}
                try { rec.release() } catch (_: Exception) {}
            }
        }
    }

    private fun shortArrayToBytes(pcm: ShortArray, frames: Int): ByteArray {
        val bytes = ByteArray(frames * 2)
        for (i in 0 until frames) {
            val v = pcm[i].toInt()
            bytes[i * 2] = (v and 0xFF).toByte()
            bytes[i * 2 + 1] = ((v shr 8) and 0xFF).toByte()
        }
        return bytes
    }

    // ---- Playback ----

    private fun startPlayback() {
        val minBuffer = AudioTrack.getMinBufferSize(
            sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val track = AudioTrack(
            AudioManager.STREAM_MUSIC,
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuffer, 48000),
            AudioTrack.MODE_STREAM)
        player = track
        track.play()
    }

    private fun writePcm(bytes: ByteArray) {
        val track = player ?: return
        try {
            val written = track.write(bytes, 0, bytes.size)
            check(written >= 0) { "Watch speaker write failed: $written" }
            if (written > 0 && !playedAudio) { playedAudio = true; android.util.Log.i("T3WatchVoice", "Provider audio playing on watch speaker") }
        } catch (e: Exception) {
            if (!closing) fail("The watch speaker stopped. Start again to reconnect.")
        }
    }

    private fun clearPlayback() {
        val track = player
        if (track != null) {
            try {
                track.pause()
                track.flush()
                track.play()
            } catch (_: Exception) {}
        }
    }

    fun setMuted(value: Boolean) {
        muted = value
    }

    private fun stopAudio() {
        recordJob?.cancel()
        try {
            recorder?.stop()
        } catch (_: Exception) {}
        recorder = null
        try {
            player?.pause()
            player?.flush()
            player?.stop()
        } catch (_: Exception) {}
        player?.release()
        player = null
    }

}
