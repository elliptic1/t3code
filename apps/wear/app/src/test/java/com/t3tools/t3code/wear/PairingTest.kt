package com.t3tools.t3code.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairingTest {

    @Test
    fun parsesLocalPairingLink() {
        val p = parsePairing("http://192.168.1.5:5733/pair#token=ABC123XYZ789")
        assertEquals("http://192.168.1.5:5733", p?.baseUrl)
        assertEquals("ABC123XYZ789", p?.code)
    }

    @Test
    fun parsesHostedPairingLink() {
        val p = parsePairing("https://app.t3.codes/pair?host=https%3A%2F%2Fmachine.tailnet.ts.net%3A44342#token=ZZY99")
        assertEquals("https://machine.tailnet.ts.net:44342", p?.baseUrl)
        assertEquals("ZZY99", p?.code)
    }

    @Test
    fun parsesT3WearWrappedLink() {
        val inner = "http%3A%2F%2F10.0.2.2%3A5733%2Fpair%23token%3DQQQ88"
        val p = parsePairing("t3wear://pair?url=$inner")
        assertEquals("http://10.0.2.2:5733", p?.baseUrl)
        assertEquals("QQQ88", p?.code)
    }

    @Test
    fun bareAddressHasNullCode() {
        val p = parsePairing("192.168.1.5:5733")
        assertEquals("http://192.168.1.5:5733", p?.baseUrl)
        assertNull(p?.code)
    }

    @Test
    fun queryTokenFallsBack() {
        val p = parsePairing("http://host:1/pair?token=AAABBB")
        assertEquals("http://host:1", p?.baseUrl)
        assertEquals("AAABBB", p?.code)
    }

    @Test
    fun garbageIsNull() {
        assertNull(parsePairing(""))
        assertNull(parsePairing("   "))
        assertNull(parsePairing("has whitespace"))
        assertNull(parsePairing("ftp://x/pair#token=ABC"))
    }
}
