# Setup

## 1. Keys

| Key | 用途 | 充值建议 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 聊天主模型 | ¥20（最低 ¥10） |
| `ZHIPU_API_KEY` | GLM-4.7-Flash 免费，做导入抽取 | ¥0 可试；建议 ¥50 防限流 |
| `DASHSCOPE_API_KEY` | qwen-flash 兜底（可选） | ¥20 |
| `SILICONFLOW_API_KEY` | Qwen3-8B 免费 / bge-m3（可选） | ¥0–20 |

写到 `whale-memory/.env`（已 gitignore），**不要贴到聊天里**。

## 2. Android

### 方案 A：命令行工具链（无需管理员，推荐）

1. JDK 21（Temurin zip）解压到 `C:\dev\jdk21`，设 `JAVA_HOME`。
2. Android command-line tools 解压到 `C:\dev\android-sdk\cmdline-tools\latest`。
3. 安装 SDK：

```powershell
sdkmanager --sdk_root=C:\dev\android-sdk "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

4. 手机开「开发者选项 → USB 调试」，连上后：

```powershell
adb devices
```

5. Capacitor 打包：

```powershell
npx cap add android
cd android
.\gradlew assembleDebug
```

### 方案 B：Android Studio

- 下载 `android-studio-rabbit1-windows.exe`（2026.2.1.8），安装时需要 UAC 确认。
- 打开 SDK Manager，装 Android 35 + build-tools。
- 适合需要可视化调试器/模拟器的人。

### 模拟器（可选）

```powershell
sdkmanager "emulator" "system-images;android-35;google_apis;x86_64"
```

需要开启虚拟化（WHPX/Hyper-V）。

## 3. GitHub

本地仓库已建好，远端需要认证，三选一：

- **A. Fine-grained PAT（repo 权限）**：我建私有仓库并 push。
- **B. 你建空私有仓库**：把 URL + PAT 给我。
- **C. 安装 `gh`**：你完成浏览器登录，我 push。

## 4. 测试数据

- DeepSeek 网页 → 设置 → 数据管理 → 导出所有历史对话。
- 真实导出放 `fixtures/private/`（已 gitignore）。
- 仓库已有 5 份合成 fixture；仍需 **1 份真实脱敏导出** 来校验官方 schema。

## 5. 成本

- DeepSeek ¥20 + BigModel ¥50（可选）+ 测试 API ¥50 ≈ ¥70–120。
- Android / GitHub 免费；VPS 二期再说。
