package com.t3tools.t3code.wear

import android.app.Activity
import android.app.RemoteInput
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Bundle
import android.speech.RecognizerIntent
import android.text.InputType
import android.widget.EditText
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.Button
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
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.net.URLDecoder
import java.net.URLEncoder

private const val PREFS = "t3wear"
private const val KEY_BASE = "baseUrl"
private const val KEY_TOKEN = "token"
private const val KEY_LABEL = "label"
private const val INPUT_RESULT_KEY = "t3_input_key"
private const val PAIRING_PATH = "/t3code/pairing"

class MainActivity : ComponentActivity() {
    private var pairingLink: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pairingLink = intent.dataString
        setContent {
            MaterialTheme {
                WearApp(getSharedPreferences(PREFS, Context.MODE_PRIVATE), pairingLink)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        pairingLink = intent.dataString
        recreate()
    }
}

@Composable
private fun WearApp(prefs: SharedPreferences, pairingLink: String?) {
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

    LaunchedEffect(Unit) {
        readPhonePairing(context) { b, t, l ->
            onPaired(b, t, l)
        }
        checkingPhone = false
    }

    AppScaffoldFallback {
        if (checkingPhone) {
            Box(modifier = Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(modifier = Modifier.size(28.dp))
            }
        } else if (baseUrl == null || pendingLink != null) {
            PairScreen(
                pendingLink = pendingLink,
                message = message,
                onPaired = onPaired,
                onMessage = { message = it },
            )
        } else {
            val nav = rememberSwipeDismissableNavController()
            SwipeDismissableNavHost(navController = nav, startDestination = "sessions") {
                composable("sessions") {
                    SessionsScreen(
                        api = T3Api(baseUrl!!, token),
                        label = label ?: "",
                        onOpen = { id -> nav.navigate("thread/${URLEncoder.encode(id, "UTF-8")}") },
                        onUnpair = { signOut(null) },
                    )
                }
                composable("thread/{id}") { entry ->
                    val id = URLDecoder.decode(entry.arguments?.getString("id") ?: "", "UTF-8")
                    ThreadScreen(
                        api = T3Api(baseUrl!!, token),
                        threadId = id,
                        onExpired = { signOut("Session expired, pair again") },
                    )
                }
            }
        }
    }
}

private fun readPhonePairing(context: Context, onFound: (String, String, String) -> Unit) {
    val listener = object : DataClient.OnDataChangedListener {
        override fun onDataChanged(events: DataEventBuffer) {
            for (event in events) {
                if (event.dataItem.uri.path == PAIRING_PATH) {
                    val dm = DataMapItem.fromDataItem(event.dataItem).dataMap
                    val base = dm.getString("baseUrl")
                    val token = dm.getString("accessToken")
                    if (!base.isNullOrBlank() && !token.isNullOrBlank()) {
                        onFound(base, token, "From Phone")
                    }
                }
            }
        }
    }
    Wearable.getDataClient(context).addListener(listener, Uri.parse("wearable:///t3code/pairing"), DataClient.FILTER_PREFIX)
    Wearable.getDataClient(context).getDataItems(Uri.parse("wearable:///t3code/pairing"))
        .addOnSuccessListener { items ->
            for (item in items) {
                val dm = DataMapItem.fromDataItem(item).dataMap
                val base = dm.getString("baseUrl")
                val token = dm.getString("accessToken")
                if (!base.isNullOrBlank() && !token.isNullOrBlank()) {
                    onFound(base, token, "From Phone")
                    break
                }
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
                item { Text("Pair T3 Code", style = MaterialTheme.typography.titleMedium) }
                item {
                    Text(
                        "On your computer run `npx t3 pair` and enter the link",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.secondary,
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
                    Button(
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
    onOpen: (String) -> Unit,
    onUnpair: () -> Unit,
) {
    var rows by remember { mutableStateOf<List<ThreadRow>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshKey by remember { mutableIntStateOf(0) }
    var confirmUnpair by remember { mutableStateOf(false) }

    val load: suspend () -> Unit = {
        try {
            rows = api.threads(); error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = if (e is SessionExpired) "Session expired, pair again" else (e.message ?: "Failed to load")
        }
    }

    PollWhileResumed(keys = listOf(refreshKey), interval = { 10000L }, load = load)

    ScreenScaffold(scrollState = rememberScalingLazyListState(), timeText = { Text(label) }) { padding ->
        ScalingLazyColumn(contentPadding = padding) {
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
                r.isEmpty() -> item { Text("No sessions", textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
                else -> {
                    items(r) { row ->
                        val needsYou = row.status == ThreadStatus.NeedsYou
                        val working = row.status == ThreadStatus.Working
                        val sub = when {
                            needsYou -> "Needs you"
                            working -> "Working"
                            else -> row.project
                        }
                        if (needsYou || working) {
                            Button(onClick = { onOpen(row.id) }, modifier = Modifier.fillMaxWidth()) {
                                Column {
                                    Text(row.title, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        } else {
                            FilledTonalButton(onClick = { onOpen(row.id) }, modifier = Modifier.fillMaxWidth()) {
                                Column {
                                    Text(row.title, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        }
                    }
                    item {
                        CompactButton(onClick = { refreshKey++ }, modifier = Modifier.fillMaxWidth()) { Text("Refresh") }
                    }
                    item {
                        if (confirmUnpair) {
                            Row(modifier = Modifier.fillMaxWidth()) {
                                CompactButton(onClick = { confirmUnpair = false }, modifier = Modifier.weight(1f)) { Text("Cancel") }
                                Spacer(Modifier.size(8.dp))
                                CompactButton(onClick = onUnpair, modifier = Modifier.weight(1f)) { Text("Unpair") }
                            }
                        } else {
                            CompactButton(onClick = { confirmUnpair = true }, modifier = Modifier.fillMaxWidth()) { Text("Unpair") }
                        }
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
    onExpired: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var title by rememberSaveable { mutableStateOf("") }
    var items by remember { mutableStateOf<List<ChatItem>>(emptyList()) }
    var status by remember { mutableStateOf(ThreadStatus.Idle) }
    var settings by remember { mutableStateOf<TurnSettings?>(null) }
    var earlierCursor by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var draft by rememberSaveable { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }

    val listState = rememberScalingLazyListState()

    fun handleError(e: Exception) {
        if (e is CancellationException) throw e
        if (e is SessionExpired) { onExpired(); return }
        error = e.message ?: "Failed"
    }

    val load: suspend () -> Unit = {
        try {
            val d = api.thread(threadId)
            title = d.title
            items = timeline(d.messages, d.activities)
            status = d.status
            settings = d.settings
            earlierCursor = d.earlierCursor
            error = null
        } catch (e: Exception) {
            handleError(e)
        }
    }

    PollWhileResumed(keys = listOf(threadId), interval = {
        if (status == ThreadStatus.Working) 3000L else 15000L
    }, load = load)

    fun send(text: String) {
        val s = settings ?: return
        sending = true
        scope.launch {
            try {
                api.send(threadId, text, s)
                draft = null; status = ThreadStatus.Working; sending = false
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                sending = false
                error = "Not sent: ${e.message ?: "failed"}"
            }
        }
    }

    LaunchedEffect(items.lastOrNull()?.key) {
        val last = items.lastOrNull()?.key ?: return@LaunchedEffect
        val index = items.indexOfLast { it.key == last }
        if (index >= 0) listState.scrollToItem(index)
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
        ScalingLazyColumn(contentPadding = padding, state = listState) {
            if (earlierCursor != null) item {
                CompactButton(
                    onClick = {
                        scope.launch {
                            try {
                                val d = api.thread(threadId, earlierCursor)
                                items = mergeById(items, timeline(d.messages, d.activities)) { it.key }
                                earlierCursor = d.earlierCursor
                            } catch (e: Exception) { handleError(e) }
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Load earlier") }
            }
            items(items) { item ->
                when (item) {
                    is ChatMessage -> {
                        if (item.fromUser) {
                            Box(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                contentAlignment = Alignment.CenterEnd,
                            ) {
                                Text(
                                    item.text,
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.fillMaxWidth(0.85f),
                                )
                            }
                        } else {
                            Text(
                                item.text,
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            )
                        }
                    }
                    is ToolSteps -> {
                        Text(
                            "\u2699 ${item.count} steps · ${item.last}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.secondary,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            if (status == ThreadStatus.Working) item {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp))
                    Spacer(Modifier.size(8.dp))
                    Text("Working…", style = MaterialTheme.typography.bodySmall)
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
                            FilledTonalButton(onClick = { draft = null }, modifier = Modifier.weight(1f)) { Text("Cancel") }
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
                            FilledTonalButton(onClick = { voiceInput.launch() }, modifier = Modifier.weight(1f)) { Text("\uD83C\uDFA4 Talk") }
                            Spacer(Modifier.size(8.dp))
                            Button(onClick = { textInput.launch() }, modifier = Modifier.weight(1f)) { Text("\u2328 Type") }
                        }
                    }
                }
            }
        }
        }
    }
}

@Composable
private fun PollWhileResumed(
    keys: List<Any>,
    interval: () -> Long,
    load: suspend () -> Unit,
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentLoad by rememberUpdatedState(load)
    val currentInterval by rememberUpdatedState(interval)
    val currentKeys by rememberUpdatedState(keys)
    LaunchedEffect(lifecycleOwner, currentKeys) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
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
        launcher.launch(intent)
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
    var text by remember(state) { mutableStateOf("") }
    ScreenScaffold(scrollState = rememberScalingLazyListState()) { padding ->
        ScalingLazyColumn(contentPadding = padding) {
            item { Text(state.title, style = MaterialTheme.typography.titleMedium) }
            item {
                AndroidView(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                    factory = { ctx ->
                        EditText(ctx).apply {
                            inputType = InputType.TYPE_CLASS_TEXT
                            hint = "Type here"
                        }
                    },
                    update = { it.setText(text) },
                )
            }
            item {
                Row(modifier = Modifier.fillMaxWidth()) {
                    FilledTonalButton(
                        onClick = { state.cancel() },
                        modifier = Modifier.weight(1f),
                    ) { Text("Cancel") }
                    Spacer(Modifier.size(8.dp))
                    Button(
                        onClick = { state.confirm(text) },
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
