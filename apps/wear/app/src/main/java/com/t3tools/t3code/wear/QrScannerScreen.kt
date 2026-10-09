package com.t3tools.t3code.wear

import android.graphics.ImageFormat
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.android.gms.tasks.Tasks
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@Composable
fun QrScannerScreen(onResult: (String) -> Unit, onCancel: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    val handled = remember { AtomicBoolean(false) }
    var previewView by remember { mutableStateOf<PreviewView?>(null) }

    val scanner = remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build()
        )
    }

    fun deliver(raw: String) {
        if (handled.compareAndSet(false, true)) {
            onResult(raw)
        }
    }

    val pv = previewView
    LaunchedEffect(pv) {
        val view = pv ?: return@LaunchedEffect
        scope.launch {
            try {
                val provider = ProcessCameraProvider.getInstance(context).get()
                val preview = Preview.Builder().build()
                preview.surfaceProvider = view.surfaceProvider
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                val executor = Executors.newSingleThreadExecutor()
                analysis.setAnalyzer(executor) { imageProxy: ImageProxy ->
                    val raw = processFrame(imageProxy, scanner)
                    if (raw != null) deliver(raw)
                }
                try {
                    provider.unbindAll()
                    provider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis,
                    )
                } catch (e: Exception) {
                    error = e.message ?: "Camera error"
                }
            } catch (e: Exception) {
                error = e.message ?: "Could not start camera"
            }
        }
    }

    ScreenScaffold(scrollState = rememberScalingLazyListState()) { padding ->
        ScalingLazyColumn(contentPadding = padding) {
            item { Text("Scan pairing QR", style = MaterialTheme.typography.titleMedium) }
            item {
                Box(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    AndroidView(
                        modifier = Modifier
                            .size(220.dp)
                            .background(Color.Black),
                        factory = { ctx ->
                            PreviewView(ctx).apply {
                                implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                            }.also { view ->
                                previewView = view
                            }
                        },
                    )
                }
            }
            error?.let { e ->
                item { Text(e, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
            }
            item {
                Button(onClick = onCancel, modifier = Modifier.fillMaxWidth()) { Text("Cancel") }
            }
        }
    }
}

private fun processFrame(
    imageProxy: ImageProxy,
    scanner: com.google.mlkit.vision.barcode.BarcodeScanner,
): String? {
    val mediaImage = imageProxy.image
    if (mediaImage == null || mediaImage.format != ImageFormat.YUV_420_888) {
        imageProxy.close()
        return null
    }
    val rotation = when (imageProxy.imageInfo.rotationDegrees) {
        90 -> 90
        180 -> 180
        270 -> 270
        else -> 0
    }
    var raw: String? = null
    try {
        val input = InputImage.fromMediaImage(mediaImage, rotation)
        val barcodes = Tasks.await(scanner.process(input), 5, TimeUnit.SECONDS)
        raw = barcodes.firstOrNull { it.rawValue != null }?.rawValue
    } catch (e: Exception) {
        raw = null
    } finally {
        imageProxy.close()
    }
    return raw
}
