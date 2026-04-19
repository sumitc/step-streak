## Android APK Deployment Guide

### Prerequisites
- Android Studio installed
- Java Development Kit (JDK) 11+
- Android SDK (API level 30+)

### Step-by-Step APK Build & Deployment

#### 1. Initialize Capacitor (One-time setup)
```bash
cd /Users/sumitc/projects/step-streak-app
npx cap init
```
Follow prompts with:
- App name: Step Streak
- App ID: com.stepstreak.app
- Directory: dist

#### 2. Build Web App
```bash
npm run build
```
Creates the `dist/` folder with optimized bundles.

#### 3. Add Android Platform (First time only)
```bash
npx cap add android
```
Creates `android/` folder with Android project files.

#### 4. Sync/Update App
```bash
npx cap sync
```
Copies updated web assets to Android project.

#### 5. Open in Android Studio
```bash
npx cap open android
```
Launches Android Studio with the native project.

#### 6. Build APK in Android Studio
1. Click **Build** menu → **Build Bundle(s) / APK(s)** → **Build APK(s)**
2. Select **debug** or **release**
3. For release:
   - Create/select your keystore
   - Set keystore password
   - Choose app signing key
4. Gradle builds the APK (may take 2-3 minutes)
5. APK is saved to: `android/app/build/outputs/apk/release/`

#### 7. Deploy APK
**Testing on device/emulator:**
```bash
adb install android/app/build/outputs/apk/release/app-release.apk
```

**Publishing to Google Play:**
1. Go to Google Play Console
2. Create new app: "Step Streak"
3. Upload the APK file
4. Fill in app description, screenshots, privacy policy
5. Submit for review (24-48 hours)

### Customization

**Change App Icon & Splash Screen:**
- Icon: `android/app/src/main/res/` (replace mipmap folders)
- Splash: Modify `android/app/src/main/AndroidManifest.xml`

**Enable Google Fit Permissions:**
Add to `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="com.google.android.gms.permission.ACTIVITY_RECOGNITION" />
<uses-permission android:name="android.permission.INTERNET" />
```

**Adjust Package Name:**
Edit `capacitor.config.json`:
```json
{
  "appId": "com.yourcompany.stepstreak",
  ...
}
```

### Troubleshooting

- **Gradle sync fails**: File → Sync Now, check Java SDK path
- **APK won't install**: Uninstall previous version first (`adb uninstall com.stepstreak.app`)
- **Build too slow**: Increase Gradle memory in `gradle.properties`

### Commands Reference
```bash
npx cap build android                # Full build process
npx cap copy android                 # Copy web assets only
npx cap update android               # Update native dependencies
npx cap open android                 # Open Android Studio
npx cap sync android                 # Sync everything
```
