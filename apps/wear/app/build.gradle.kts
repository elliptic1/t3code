import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.t3tools.t3code.wear"
    compileSdk = 36

    defaultConfig {
        // The Wear Data Layer only syncs between a phone app and a watch app with the same
        // package id and signing certificate, so both follow the phone build being paired with.
        applicationId = providers.gradleProperty("t3.applicationId").get()
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        // Expo prebuild's keystore, which signs the phone app's local builds. Pass
        // -Pt3.keystore=<path> when the phone's android/ directory is not generated beside this one.
        val phoneKeystore = providers.gradleProperty("t3.keystore").orNull
            ?.let { file(it) } ?: rootProject.file("../mobile/android/app/debug.keystore")
        if (phoneKeystore.exists()) {
            getByName("debug") {
                storeFile = phoneKeystore
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        release {
            // Local companion installs must retain the phone's signing identity.
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = true
            isShrinkResources = true
            ndk.debugSymbolLevel = "none"
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }

    // Native libraries come prebuilt from dependencies; the watch app needs no local NDK.
    packaging {
        jniLibs.keepDebugSymbols.add("**/*.so")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.wear.compose.material3)
    implementation(libs.wear.compose.foundation)
    implementation(libs.wear.compose.navigation)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.coroutines.android)
    implementation(libs.coroutines.play.services)
    implementation(libs.wear.input)
    implementation(libs.wearable)
    implementation(libs.camera.core)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.mlkit.barcode)
    implementation(libs.okhttp)
    implementation(libs.watchface.complications.data.source)

    testImplementation(libs.junit)
    testImplementation(libs.mockwebserver)
    testImplementation("org.json:json:20240303")
}
