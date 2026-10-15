package com.t3tools.t3code.wear

import android.app.Activity
import android.app.RemoteInput
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognizerIntent
import android.text.InputType
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.Toast
import android.Manifest
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.widget.doAfterTextChanged
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.CompactButton
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import androidx.wear.input.RemoteInputIntentHelper
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.net.URLDecoder
import java.net.URLEncoder

internal const val EXTRA_THREAD_ID = "threadId"
internal const val EXTRA_ENVIRONMENT_ID = "environmentId"

internal const val PREFS = "t3wear"
private const val KEY_BASE = "baseUrl"
private const val KEY_TOKEN = "token"
private const val KEY_LABEL = "label"
private const val INPUT_RESULT_KEY = "t3_input_key"

class MainActivity : ComponentActivity() {
    private var pairingLink: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pairingLink = intent.dataString
        setContent {
            T3Theme {
                WearApp(getSharedPreferences(PREFS, Context.MODE_PRIVATE), pairingLink, intent.getStringExtra(EXTRA_THREAD_ID))
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pairingLink = intent.dataString
        recreate()
    }
}

@Composable
private fun WearApp(prefs: SharedPreferences, pairingLink: String?, openThreadId: String?) {
    var baseUrl by rememberSaveable { mutableStateOf(prefs.getString(KEY_BASE, null)) }
    var token by rememberSaveable { mutableStateOf(prefs.getString(KEY_TOKEN, null)) }
    var label by rememberSaveable { mutableStateOf(prefs.getString(KEY_LABEL, null)) }
    var message by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingLink by rememberSaveable { mutableStateOf(pairingLink) }
    var checkingPhone by remember { mutableStateOf(true) }

    val context = LocalContext.current

    val onPaired: (String, String, String) -> Unit = { b, t, l ->
        prefs.edit().putString(KEY_BASE, b).putString(KEY_TOKEN, t).putString(KEY_LABEL, l).apply()
        baseUrl = b; token = t; label = l
        pendingLink = null; message = null
    }
    val signOut: (String?) -> Unit = { msg ->
        prefs.edit().remove(KEY_BASE).remove(KEY_TOKEN).remove(KEY_LABEL).apply()
        baseUrl = null; token = null; label = null
        message = msg
    }

    ObservePhoneConnection(
        context = context,
        onFound = { b, t, l ->
            if (pendingLink == null) onPaired(b, t, l)
            checkingPhone = false
        },
        onChecked = { checkingPhone = false },
        onRemoved = { signOut(null) },
    )

    AppScaffoldFallback {
        if (checkingPhone) {
            Box(modifier = Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(modifier = Modifier.size(28.dp))
            }
        } else if (pendingLink != null) {
            PairScreen(
                pendingLink = pendingLink,
                message = message,
                onPaired = onPaired,
                onMessage = { message = it },
            )
        } else if (baseUrl == null) {
            PhoneConnectionScreen(message)
        } else {
            key(baseUrl, token) {
                val api = remember(baseUrl, token) { T3Api(baseUrl!!, token) }
                var openingThread by remember { mutableStateOf<ThreadRow?>(null) }
                val nav = rememberSwipeDismissableNavController()
                LaunchedEffect(openThreadId) {
                    if (openThreadId != null) nav.navigate("thread/${URLEncoder.encode(openThreadId, "UTF-8")}")
                }
                SwipeDismissableNavHost(navController = nav, startDestination = "sessions") {
                    composable("sessions") {
                        SessionsScreen(
                            api = api,
                            label = label ?: "",
                            onOpen = { row ->
                                openingThread = row
                                nav.navigate("thread/${URLEncoder.encode(row.id, "UTF-8")}") {
                                    launchSingleTop = true
                                }
                            },
                            onVoice = {
                                nav.navigate("voice") { launchSingleTop = true }
                            },
                        )
                    }
                    composable("thread/{id}") { entry ->
                        val id = URLDecoder.decode(entry.arguments?.getString("id") ?: "", "UTF-8")
                        ThreadScreen(
                            api = api,
                            threadId = id,
                            initialTitle = openingThread?.takeIf { it.id == id }?.title.orEmpty(),
                            onExpired = { signOut("Open T3 Code on your phone to refresh the connection") },
                        )
                    }
                    composable("voice") {
                        VoiceScreen(
                            api = api,
                            onExpired = { signOut("Open T3 Code on your phone to refresh the connection") },
                            onBack = { nav.popBackStack() },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PhoneConnectionScreen(message: String?) {
    Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Connect from phone", style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary, textAlign = TextAlign.Center)
            Text("Open T3 Code on your paired phone. Your connection will sync automatically.",
                style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            message?.let { Text(it, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center) }
        }
    }
}

@Composable
private fun AppScaffoldFallback(content: @Composable () -> Unit) {
    content()
}

@Composable
private fun PairScreen(
    pendingLink: String?,
    message: String?,
    onPaired: (String, String, String) -> Unit,
    onMessage: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var stagedBase by rememberSaveable { mutableStateOf<String?>(null) }
    var busy by rememberSaveable { mutableStateOf(false) }
    var needCode by rememberSaveable { mutableStateOf(false) }

    val connect: (String, String?) -> Unit = { base, code ->
        if (code == null) {
            stagedBase = base; needCode = true
        } else {
            busy = true
            val api = T3Api(base, null)
            scope.launch {
                try {
                    val l = api.environmentLabel()
                    val t = api.pair(code)
                    onPaired(base, t, l)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: SessionExpired) {
                    busy = false; onMessage("Session expired, pair again")
                } catch (e: Exception) {
                    busy = false; onMessage(e.message ?: "Failed to pair")
                }
            }
        }
    }

    LaunchedEffect(pendingLink) {
        if (pendingLink != null) {
            val p = parsePairing(pendingLink)
            if (p != null) connect(p.baseUrl, p.code)
        }
    }

    val enterLink = rememberTextInput("Pairing link or address") { input ->
        val p = parsePairing(input)
        if (p == null) onMessage("Not a valid link or address")
        else connect(p.baseUrl, p.code)
    }

    val enterCode = rememberTextInput("Pairing code") { code ->
        val base = stagedBase ?: return@rememberTextInput
        connect(base, code)
    }

    when {
        enterLink.open -> TextEntrySheet(enterLink)
        enterCode.open -> TextEntrySheet(enterCode)
        else -> ScreenScaffold(scrollState = rememberScalingLazyListState()) { padding ->
            ScalingLazyColumn(contentPadding = padding) {
                item {
                    Text(
                        "T3 Code",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                item {
                    Text(
                        "On your computer run `npx t3 pair` and enter the link",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
                message?.let { m ->
                    item { Text(m, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                }
                if (busy) item {
                    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(modifier = Modifier.size(28.dp))
                    }
                }
                item {
                    Button(
                        onClick = { enterLink.launch() },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Enter link or address") }
                }
                if (needCode) item {
                    FilledTonalButton(
                        onClick = { enterCode.launch() },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Enter code") }
                }
            }
        }
    }
}

@Composable
private fun SessionsScreen(
    api: T3Api,
    label: String,
    onOpen: (ThreadRow) -> Unit,
    onVoice: () -> Unit,
) {
    var rows by remember { mutableStateOf<List<ThreadRow>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshKey by remember { mutableIntStateOf(0) }
    var showSettled by rememberSaveable { mutableStateOf(false) }
    val listState = rememberWatchListState()

    val load: suspend () -> Unit = {
        try {
            val updated = api.threads()
            awaitWatchScrollIdle(listState)
            rows = updated; error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = if (e is SessionExpired) "Open T3 Code on your phone to refresh the connection" else (e.message ?: "Failed to load")
        }
    }

    PollWhileResumed(keys = listOf(refreshKey), interval = { 10000L }, load = load)

    val (settled, active) = remember(rows) { rows.orEmpty().partition { it.tucked } }
    ScreenScaffold(scrollState = listState, timeText = { Text(label) }) { padding ->
        WatchLazyColumn(contentPadding = padding, state = listState) {
            val r = rows
            when {
                error != null -> item {
                    Text(error!!, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                }
                r == null -> item {
                    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(modifier = Modifier.size(28.dp))
                    }
                }
                else -> {
                    item(key = "voice-cta", contentType = "control") {
                        Button(
                            onClick = onVoice,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary,
                                contentColor = MaterialTheme.colorScheme.onPrimary,
                            ),
                        ) { Text("\uD83C\uDFA4 Talk") }
                    }
                    if (active.isEmpty()) item(key = "empty-active") {
                        Text(
                            "No active threads",
                            textAlign = TextAlign.Center,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    items(active, key = { "thread:${it.id}" }, contentType = { "session" }) { row ->
                        SessionButton(row) { onOpen(row) }
                    }
                    if (settled.isNotEmpty()) {
                        item(key = "settled-toggle", contentType = "control") {
                            CompactButton(
                                onClick = { showSettled = !showSettled },
                                modifier = Modifier.fillMaxWidth(),
                                colors = settledColors(),
                            ) { Text("${if (showSettled) "▾" else "▸"} Settled (${settled.size})") }
                        }
                        if (showSettled) items(settled, key = { "thread:${it.id}" }, contentType = { "session" }) { row ->
                            SessionButton(row) { onOpen(row) }
                        }
                    }
                    item(key = "refresh", contentType = "control") {
                        CompactButton(
                            onClick = { refreshKey++ },
                            modifier = Modifier.fillMaxWidth(),
                            colors = activeColors(),
                        ) { Text("Refresh") }
                    }

                }
            }
        }
    }
}

@Composable
private fun ThreadScreen(
    api: T3Api,
    threadId: String,
    initialTitle: String,
    onExpired: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var title by rememberSaveable(threadId) { mutableStateOf(initialTitle) }
    var items by remember { mutableStateOf<List<ChatItem>>(emptyList()) }
    var status by remember { mutableStateOf(ThreadStatus.Idle) }
    var settings by remember { mutableStateOf<TurnSettings?>(null) }
    var earlierCursor by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var draft by rememberSaveable { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    var followLatest by remember { mutableStateOf(true) }

    val listState = rememberWatchListState()

    fun handleError(e: Exception) {
        if (e is CancellationException) throw e
        if (e is SessionExpired) { onExpired(); return }
        error = e.message ?: "Failed"
    }

    val load: suspend () -> Unit = {
        try {
            val d = api.thread(threadId)
            val incoming = withContext(Dispatchers.Default) {
                timeline(d.messages, d.activities)
            }
            awaitWatchScrollIdle(listState)
            val lastMessageIndex = items.lastIndex + if (earlierCursor != null) 1 else 0
            followLatest = settings == null ||
                (listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1) >= lastMessageIndex
            title = d.title
            items = mergeById(items, incoming) { it.key }
            status = d.status
            settings = d.settings
            earlierCursor = d.earlierCursor
            error = null
        } catch (e: Exception) {
            handleError(e)
        }
    }

    PollWhileResumed(keys = listOf(threadId), minActiveState = Lifecycle.State.STARTED, interval = {
        if (status == ThreadStatus.Working) 3000L else 15000L
    }, load = load)

    fun send(text: String) {
        val s = settings ?: return
        sending = true
        error = null
        scope.launch {
            try {
                api.send(threadId, text, s)
                draft = null; status = ThreadStatus.Working
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = "Not sent: ${e.message ?: "failed"}"
            } finally {
                sending = false
            }
        }
    }

    LaunchedEffect(items.lastOrNull()?.key) {
        if (!followLatest) return@LaunchedEffect
        val index = items.lastIndex
        if (index >= 0) listState.scrollToItem(index + if (earlierCursor != null) 1 else 0)
    }

    val textInput = rememberTextInput("Message") { t -> draft = t }
    val voiceInput = rememberVoiceInput { t -> draft = t }

    when {
        textInput.open -> TextEntrySheet(textInput)
        voiceInput.open -> TextEntrySheet(voiceInput)
        else -> ScreenScaffold(
            scrollState = listState,
            timeText = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        ) { padding ->
        WatchLazyColumn(contentPadding = padding, state = listState) {
            if (earlierCursor != null) item(key = "earlier", contentType = "control") {
                CompactButton(
                    onClick = {
                        scope.launch {
                            try {
                                val d = api.thread(threadId, earlierCursor)
                                val incoming = withContext(Dispatchers.Default) {
                                    timeline(d.messages, d.activities)
                                }
                                items = mergeById(incoming, items) { it.key }
                                earlierCursor = d.earlierCursor
                            } catch (e: Exception) { handleError(e) }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Load earlier") }
            }
            if (items.isEmpty() && error == null) item {
                if (settings == null) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(title, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        CircularProgressIndicator(modifier = Modifier.size(28.dp))
                    }
                } else {
                    Text("No conversation yet", style = MaterialTheme.typography.bodySmall)
                }
            }
            items(items, key = { "chat:${it.key}" }, contentType = {
                when (it) {
                    is ChatMessage -> "message"
                    is ToolSteps -> "steps"
                }
            }) { item ->
                when (item) {
                    is ChatMessage -> MessageBubble(item)
                    is ToolSteps -> {
                        Text(
                            "\u2699 ${item.count} steps · ${item.last}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.secondary,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier
                                .background(MaterialTheme.colorScheme.secondaryContainer, RoundedCornerShape(50))
                                .padding(horizontal = 10.dp, vertical = 4.dp),
                        )
                    }
                }
            }
            if (status == ThreadStatus.Working) item {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp))
                    Spacer(Modifier.size(8.dp))
                    Text(
                        "Working…",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.secondary,
                    )
                }
            }
            error?.let { e ->
                item { Text(e, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
            }
            when {
                draft != null -> {
                    item {
                        Text(draft!!, style = MaterialTheme.typography.bodyMedium, maxLines = 4, overflow = TextOverflow.Ellipsis)
                    }
                    item {
                        Row(modifier = Modifier.fillMaxWidth()) {
                            FilledTonalButton(onClick = { draft = null }, modifier = Modifier.weight(1f), colors = settledColors()) { Text("Cancel") }
                            Spacer(Modifier.size(8.dp))
                            Button(
                                onClick = { draft?.let { send(it) } },
                                enabled = !sending,
                                modifier = Modifier.weight(1f),
                            ) { Text(if (sending) "Sending…" else "Send") }
                        }
                    }
                }
                else -> {
                    item {
                        Row(modifier = Modifier.fillMaxWidth()) {
                            Button(onClick = { voiceInput.launch() }, modifier = Modifier.weight(1f)) { Text("\uD83C\uDFA4 Talk") }
                            Spacer(Modifier.size(8.dp))
                            FilledTonalButton(onClick = { textInput.launch() }, modifier = Modifier.weight(1f), colors = activeColors()) { Text("\u2328 Type") }
                        }
                    }
                }
            }
        }
        }
    }
}

/**
 * Live voice conversation on the watch. Requests the microphone, reads the transcript
 * history synced from the phone, and streams audio to the provider over the same
 * WebSocket/PCM path the phone uses (xai/local presets). WebRTC servers are unsupported
 * here and surface a clear message instead.
 */
@Composable
private fun VoiceScreen(
    api: T3Api,
    onExpired: () -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var history by remember { mutableStateOf<List<VoiceHistoryLine>>(emptyList()) }
    var session by remember { mutableStateOf<VoiceSession?>(null) }
    var transcript by remember { mutableStateOf<List<String>>(emptyList()) }
    var starting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var needsPermission by remember { mutableStateOf(false) }
    var muted by remember { mutableStateOf(false) }
    var sessionState by remember { mutableStateOf<VoiceSession.State?>(null) }
    val listState = rememberWatchListState()

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> needsPermission = !granted }

    LaunchedEffect(Unit) {
        val hasMic = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        if (hasMic) needsPermission = false
        else permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
    }

    ObserveVoiceHistory(context) { lines -> history = lines }

    LaunchedEffect(sessionState) {
        if (sessionState == VoiceSession.State.CLOSED) {
            session = null
            onBack()
        }
    }

    fun start() {
        if (starting) return
        starting = true
        error = null
        scope.launch {
            try {
                val connection = api.createVoiceSession()
                if (connection.transport != "websocket") {
                    error = "This server uses WebRTC voice, which the watch doesn't support. Switch to the xAI or local voice provider, then retry."
                    starting = false
                    return@launch
                }
                val voice = VoiceSession(
                    connection = connection,
                    history = history,
                    onEvent = { },
                    onTranscript = { text ->
                        transcript = (transcript + text).takeLast(20)
                    },
                    onError = { message -> error = message },
                    onState = { state -> sessionState = state },
                )
                session = voice
                voice.start()
            } catch (e: CancellationException) {
                throw e
            } catch (e: SessionExpired) {
                onExpired()
            } catch (e: Exception) {
                error = e.message ?: "Could not start voice"
            } finally {
                starting = false
            }
        }
    }

    ScreenScaffold(scrollState = rememberScalingLazyListState(), timeText = { Text("Voice") }) { padding ->
        WatchLazyColumn(contentPadding = padding, state = listState) {
            if (error != null) item {
                Text(error!!, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
            if (needsPermission) item {
                Text(
                    "Microphone access is required for voice. Allow it in settings.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
            if (session == null) {
                item {
                    if (transcript.isEmpty()) {
                        Text(
                            "Talk to the agent on your paired phone's T3 Code. Uses the same memory and settings.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
                item {
                    Row(modifier = Modifier.fillMaxWidth()) {
                        FilledTonalButton(
                            onClick = onBack,
                            modifier = Modifier.weight(1f),
                            colors = settledColors(),
                        ) { Text("Back") }
                        Spacer(Modifier.size(8.dp))
                        Button(
                            onClick = { start() },
                            enabled = !starting && !needsPermission,
                            modifier = Modifier.weight(1f),
                        ) { Text(if (starting) "Starting…" else "\uD83C\uDFA4 Talk") }
                    }
                }
            } else {
                item {
                    Text(
                        if (muted) "Listening muted" else "Listening",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                item {
                    val shown = if (transcript.isEmpty()) history.takeLast(4).map { it.text } else transcript.takeLast(4)
                    if (shown.isEmpty()) {
                        Text(
                            "Say something…",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            shown.forEach { line ->
                                Text(
                                    line,
                                    style = MaterialTheme.typography.bodySmall,
                                    maxLines = 3,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
                item {
                    Row(modifier = Modifier.fillMaxWidth()) {
                        FilledTonalButton(
                            onClick = { muted = !muted; session?.setMuted(muted) },
                            modifier = Modifier.weight(1f),
                            colors = if (muted) settledColors() else activeColors(),
                        ) { Text(if (muted) "Unmute" else "Mute") }
                        Spacer(Modifier.size(8.dp))
                        Button(
                            onClick = { session?.close() },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.error,
                                contentColor = MaterialTheme.colorScheme.onError,
                            ),
                        ) { Text("End") }
                    }
                }
            }
        }
    }
}

/**
 * Color follows state, with the same written status so color is never the only signal.
 */
@Composable
private fun SessionButton(row: ThreadRow, onClick: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val (container, content, accent, stateLabel) = when {
        row.status == ThreadStatus.NeedsYou -> SessionStyle(scheme.tertiary, scheme.onTertiary, scheme.onTertiary, "Needs you")
        row.status == ThreadStatus.Working -> SessionStyle(scheme.secondaryContainer, scheme.onSurface, scheme.secondary, "Working")
        row.status == ThreadStatus.Failed -> SessionStyle(scheme.error, scheme.onError, scheme.onError, "Failed")
        row.settled -> SessionStyle(scheme.surfaceContainer, scheme.onSurfaceVariant, scheme.onSurfaceVariant, "Settled")
        else -> SessionStyle(scheme.primaryContainer, scheme.onPrimaryContainer, scheme.primary, "Active")
    }
    val sub = if (row.project.isBlank()) stateLabel else "$stateLabel · ${row.project}"
    Button(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = ButtonDefaults.buttonColors(
            containerColor = container,
            contentColor = content,
            secondaryContentColor = accent,
        ),
        icon = { Box(Modifier.size(10.dp).background(accent, CircleShape)) },
        label = { Text(row.title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        secondaryLabel = if (sub.isNotEmpty()) {
            { Text(sub, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        } else null,
    )
}

private data class SessionStyle(val container: Color, val content: Color, val accent: Color, val sub: String)

@Composable
private fun activeColors() = ButtonDefaults.buttonColors(
    containerColor = MaterialTheme.colorScheme.primaryContainer,
    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
)

@Composable
private fun settledColors() = ButtonDefaults.buttonColors(
    containerColor = MaterialTheme.colorScheme.surfaceContainer,
    contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
)

/** You on the right in violet, the agent on the left in a quiet surface. */
@Composable
private fun MessageBubble(message: ChatMessage) {
    val scheme = MaterialTheme.colorScheme
    val fromUser = message.fromUser
    Box(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        contentAlignment = if (fromUser) Alignment.CenterEnd else Alignment.CenterStart,
    ) {
        Text(
            message.text,
            style = MaterialTheme.typography.bodyMedium,
            color = if (fromUser) scheme.onPrimaryContainer else scheme.onSurface,
            modifier = Modifier
                .fillMaxWidth(0.88f)
                .background(
                    if (fromUser) scheme.primaryContainer else scheme.surfaceContainerHigh,
                    RoundedCornerShape(
                        topStart = 18.dp,
                        topEnd = 18.dp,
                        bottomStart = if (fromUser) 18.dp else 4.dp,
                        bottomEnd = if (fromUser) 4.dp else 18.dp,
                    ),
                )
                .padding(horizontal = 12.dp, vertical = 8.dp),
        )
    }
}

@Composable
private fun PollWhileResumed(
    keys: List<Any>,
    interval: () -> Long,
    load: suspend () -> Unit,
    minActiveState: Lifecycle.State = Lifecycle.State.RESUMED,
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentLoad by rememberUpdatedState(load)
    val currentInterval by rememberUpdatedState(interval)
    val currentKeys by rememberUpdatedState(keys)
    LaunchedEffect(lifecycleOwner, currentKeys, minActiveState) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(minActiveState) {
            while (true) {
                currentLoad()
                delay(currentInterval())
            }
        }
    }
}

@Composable
private fun rememberTextInput(label: String, onText: (String) -> Unit): TextEntryState {
    val context = LocalContext.current
    val currentOnText by rememberUpdatedState(onText)
    val state = remember { TextEntryState() }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            val results = RemoteInput.getResultsFromIntent(result.data!!)
            val text = results?.getCharSequence(INPUT_RESULT_KEY)?.toString()
            if (!text.isNullOrBlank()) currentOnText(text)
        }
    }

    val realLaunch: () -> Unit = {
        val intent = RemoteInputIntentHelper.createActionRemoteInputIntent()
        val remoteInput = RemoteInput.Builder(INPUT_RESULT_KEY).setLabel(label).build()
        RemoteInputIntentHelper.putRemoteInputsExtra(intent, listOf(remoteInput))
        try {
            launcher.launch(intent)
        } catch (e: ActivityNotFoundException) {
            state.openSheet(label) { t -> currentOnText(t) }
        }
    }

    val hasWearInput = remember {
        context.packageManager.resolveActivity(
            Intent("android.support.wearable.input.action.REMOTE_INPUT"),
            0,
        ) != null
    }

    val fallbackLaunch: (() -> Unit)? = if (hasWearInput) null else {
        { state.openSheet(label) { t -> currentOnText(t) } }
    }
    state.wearLaunch = if (hasWearInput) realLaunch else null
    state.fallbackLaunch = fallbackLaunch
    return state
}

@Composable
private fun TextEntrySheet(state: TextEntryState?) {
    if (state == null || !state.open) return
    var text by rememberSaveable { mutableStateOf("") }
    ScreenScaffold(scrollState = rememberScalingLazyListState()) { padding ->
        ScalingLazyColumn(contentPadding = padding) {
            item { Text(state.title, style = MaterialTheme.typography.titleMedium) }
            item {
                AndroidView(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                    factory = { ctx ->
                        EditText(ctx).apply {
                            inputType = InputType.TYPE_CLASS_TEXT
                            setSingleLine(true)
                            imeOptions = EditorInfo.IME_ACTION_DONE
                            hint = "Type here"
                            doAfterTextChanged { text = it?.toString().orEmpty() }
                            setOnEditorActionListener { view, actionId, _ ->
                                if (actionId == EditorInfo.IME_ACTION_DONE) {
                                    val keyboard = ctx.getSystemService(InputMethodManager::class.java)
                                    keyboard.hideSoftInputFromWindow(view.windowToken, 0)
                                    state.confirm(view.text.toString())
                                    true
                                } else false
                            }
                        }
                    },
                    update = { view ->
                        if (view.text.toString() != text) {
                            view.setText(text)
                            view.setSelection(text.length)
                        }
                    },
                )
            }
            item {
                Row(modifier = Modifier.fillMaxWidth()) {
                    FilledTonalButton(
                        onClick = { state.cancel() },
                        modifier = Modifier.weight(1f),
                        colors = settledColors(),
                    ) { Text("Cancel") }
                    Spacer(Modifier.size(8.dp))
                    Button(
                        onClick = { state.confirm(text) },
                        enabled = text.isNotBlank(),
                        modifier = Modifier.weight(1f),
                    ) { Text("OK") }
                }
            }
        }
    }
}

@Composable
private fun rememberVoiceInput(onText: (String) -> Unit): TextEntryState {
    val context = LocalContext.current
    val currentOnText by rememberUpdatedState(onText)
    val state = remember { TextEntryState() }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            val results = result.data!!.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            val text = results?.firstOrNull()
            if (!text.isNullOrBlank()) currentOnText(text)
        }
    }
    val hasRecognizer = remember {
        context.packageManager.resolveActivity(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH),
            0,
        ) != null
    }
    state.wearLaunch = if (hasRecognizer) {
        {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak your message")
            }
            try {
                launcher.launch(intent)
            } catch (e: ActivityNotFoundException) {
                state.openSheet("Talk") { t -> currentOnText(t) }
            }
        }
    } else {
        { state.openSheet("Talk") { t -> currentOnText(t) } }
    }
    return state
}

private class TextEntryState {
    var open by mutableStateOf(false)
        private set
    var title by mutableStateOf("")
        private set
    var onSubmit by mutableStateOf<(String) -> Unit>({})
        private set
    var wearLaunch: (() -> Unit)? = null
    var fallbackLaunch: (() -> Unit)? = null

    fun launch() {
        val w = wearLaunch
        if (w != null) {
            w()
        } else {
            fallbackLaunch?.invoke()
        }
    }

    fun openSheet(t: String, cb: (String) -> Unit) {
        title = t; onSubmit = cb; open = true
    }

    fun confirm(text: String) {
        open = false
        val cb = onSubmit
        if (text.isNotBlank()) cb(text)
    }

    fun cancel() {
        open = false
    }
}
