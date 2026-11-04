package com.t3tools.t3code.wear

import java.net.URLDecoder

data class Pairing(val baseUrl: String, val code: String?)

fun parsePairing(input: String): Pairing? {
    val trimmed = input.trim()
    if (trimmed.isEmpty() || trimmed.any { it.isWhitespace() }) return null
    return parseRecursive(trimmed)
}

private fun parseRecursive(raw: String): Pairing? {
    // t3wear://pair?url=<encoded X> -> recurse on the decoded X
    if (raw.startsWith("t3wear://")) {
        val query = raw.substringAfter('?', "")
        val urlParam = query.split("&").firstOrNull { it.startsWith("url=") }
            ?.substringAfter("url=") ?: return null
        return parseRecursive(urlDecode(urlParam))
    }

    val withScheme = if (!raw.contains("://")) "http://$raw" else raw

    val schemeEnd = withScheme.indexOf("://")
    val scheme = withScheme.substring(0, schemeEnd).lowercase()
    if (scheme != "http" && scheme != "https") return null

    val rest = withScheme.substring(schemeEnd + 3)
    val pathEnd = rest.indexOfAny(charArrayOf('/', '?', '#'))
    val authority = if (pathEnd == -1) rest else rest.substring(0, pathEnd)
    if (authority.isEmpty() || authority.contains('@')) return null

    // Raw query and fragment, un-decoded
    val queryStart = rest.indexOf('?')
    val fragmentStart = rest.indexOf('#')
    val rawQuery = if (queryStart != -1 && (fragmentStart == -1 || queryStart < fragmentStart))
        rest.substring(queryStart + 1, if (fragmentStart == -1) rest.length else fragmentStart) else null
    val rawFragment = if (fragmentStart != -1) rest.substring(fragmentStart + 1) else null

    val code = extractToken(rawFragment) ?: extractToken(rawQuery)

    val hostParam = rawQuery?.split("&")?.firstOrNull { it.startsWith("host=") }
        ?.substringAfter("host=")
    val baseUrl = if (hostParam != null) urlDecode(hostParam).trimEnd('/')
    else "$scheme://$authority"

    return Pairing(baseUrl, code)
}

private fun extractToken(queryOrFragment: String?): String? {
    if (queryOrFragment == null) return null
    for (pair in queryOrFragment.split("&")) {
        if (pair.startsWith("token=")) {
            return urlDecode(pair.substringAfter("token="))
        }
    }
    return null
}

private fun urlDecode(s: String): String = try {
    URLDecoder.decode(s, "UTF-8")
} catch (e: Exception) {
    s
}
