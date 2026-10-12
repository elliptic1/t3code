package com.t3tools.t3code.wear

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.MonochromaticImage
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService
import kotlinx.coroutines.CancellationException

/**
 * Watch face complication for the threads that are waiting on the user. The short form shows how
 * many wait, the long form names the most recently active one. Tapping opens that thread.
 */
class AttentionComplicationService : SuspendingComplicationDataSourceService() {

    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        render(type, Attention(2, ThreadRow("preview", "Approve the deploy", "my-app", ThreadStatus.NeedsYou, "")))

    override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData? {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val base = prefs.getString(KEY_BASE, null)
        val token = prefs.getString(KEY_TOKEN, null)
        if (base == null || token == null) return unavailable(request.complicationType, "Pair T3")
        return try {
            render(request.complicationType, attention(T3Api(base, token).threads()))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Off the home network the watch cannot reach the server; say so instead of showing 0.
            unavailable(request.complicationType, "T3 unreachable")
        }
    }

    private fun render(type: ComplicationType, attention: Attention): ComplicationData? {
        val thread = attention.first
        val tap = open(thread?.id)
        val description = PlainComplicationText.Builder(
            if (thread == null) "No threads need you" else "${attention.count} threads need you: ${thread.title}",
        ).build()
        val icon = MonochromaticImage.Builder(Icon.createWithResource(this, R.drawable.ic_attention)).build()
        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(
                PlainComplicationText.Builder(attention.count.toString()).build(),
                description,
            ).setTitle(PlainComplicationText.Builder("T3").build())
                .setMonochromaticImage(icon)
                .setTapAction(tap)
                .build()

            ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(
                PlainComplicationText.Builder(thread?.title ?: "All clear").build(),
                description,
            ).setTitle(
                PlainComplicationText.Builder(
                    when {
                        thread == null -> "T3"
                        attention.count > 1 -> "${attention.count} need you"
                        else -> "Needs you"
                    },
                ).build(),
            ).setMonochromaticImage(icon)
                .setTapAction(tap)
                .build()

            else -> null
        }
    }

    private fun unavailable(type: ComplicationType, message: String): ComplicationData? {
        val text = PlainComplicationText.Builder(message).build()
        val tap = open(null)
        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(
                PlainComplicationText.Builder("–").build(),
                text,
            ).setTitle(PlainComplicationText.Builder("T3").build()).setTapAction(tap).build()

            ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(text, text)
                .setTitle(PlainComplicationText.Builder("T3").build())
                .setTapAction(tap)
                .build()

            else -> null
        }
    }

    private fun open(threadId: String?): PendingIntent {
        val intent = Intent(this, MainActivity::class.java).apply {
            if (threadId != null) putExtra(EXTRA_THREAD_ID, threadId)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(
            this,
            threadId.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}

fun requestAttentionComplicationUpdate(context: Context) {
    ComplicationDataSourceUpdateRequester
        .create(context, ComponentName(context, AttentionComplicationService::class.java))
        .requestUpdateAll()
}
