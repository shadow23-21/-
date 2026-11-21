# Android

## 工具链

| 组件 | 路径 |
|---|---|
| JDK 21 | `C:\dev\jdk21` |
| Android SDK | `C:\dev\android-sdk` |
| platform | `platforms/android-36` |
| build-tools | `build-tools/36.0.0` |
| platform-tools | `C:\dev\android-sdk\platform-tools` |

## 构建

```powershell
cd web
$env:VITE_API_BASE='http://127.0.0.1:8787'
npm.cmd run build
npx.cmd cap sync android

cd android
$env:JAVA_HOME='C:\dev\jdk21'
$env:ANDROID_HOME='C:\dev\android-sdk'
$env:Path="C:\dev\jdk21\bin;C:\dev\android-sdk\platform-tools;$env:Path"
.\gradlew.bat assembleDebug --no-daemon
```

产物：`web/android/app/build/outputs/apk/debug/app-debug.apk`

## 手机调试

```powershell
adb reverse tcp:8787 tcp:8787
adb install -r web/android/app/build/outputs/apk/debug/app-debug.apk
adb shell monkey -p com.whalememory.app -c android.intent.category.LAUNCHER 1
```

- `adb reverse` 把手机的 `127.0.0.1:8787` 映射到电脑的 gateway；WebView 里的 `VITE_API_BASE` 就是它。
- 手机需要：USB 调试、USB 安装、USB 调试（安全设置）。
- Redmi/Xiaomi 报 `INSTALL_FAILED_USER_RESTRICTED` 时，就是上面后两个开关没开；部分机型还要求登录小米账号/插 SIM。
- 当前 Redmi M332BF 已安装成功并启动；开启「USB 调试（安全设置）」后，`adb shell input tap/text` 可用。
- 已验证：ADB 输入 `hello` → 角色回复 → `am force-stop` → 重启，恢复 242 条会话和 hello/回复。
- 主界面是纯聊天；左上角 ☰ 进角色列表，右上角「记忆」「设置」进入独立页。
- 每个角色独立的 story bible / 消息 / 记忆；消息右上角「记住」写入长期记忆。
- App 名「鲸忆」，图标是蓝紫渐变 + 鲸字。
- 聊天记录写入 WebView 的 IndexedDB，杀进程/重启后恢复。

## 生产注意

- `androidScheme: http` + `cleartext: true` 只用于本地调试。
- 正式版：gateway 上 HTTPS，App 用 `https://`；key 不进 WebView 的 localStorage，改走系统安全存储。
- `adb reverse` 只适合 USB 调试；真机分发要么把 gateway 部署到公网，要么做端内直连（需处理 CORS/鉴权）。
