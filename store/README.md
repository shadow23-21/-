# 鲸忆 · 上架素材包

这个目录是给 Google Play / App Store / 国内安卓商店准备的材料，不包含签名密钥（在 `release/keystore-backup/`）。

## 文件

| 文件 | 用途 |
|---|---|
| `icon-512.png` | 商店图标 512×512 |
| `feature-graphic.png` | Google Play 特色图 1024×500 |
| `screenshots/` | 手机截图（聊天 / 角色 / 记忆） |
| `listing-zh.md` | 中文商店文案 |
| `listing-en.md` | 英文商店文案 |
| `privacy-policy.md` | 隐私政策模板（必须填运营者/邮箱并托管到公网 URL） |
| `store-checklist.md` | 各商店上架步骤和合规清单 |
| `pricing.md` | 建议零售价 / 额度套餐 |

## 最快路径

1. **直接分发签名 APK**：用 `scripts/build-release.ps1 -GatewayUrl https://...` 构建托管额度版，官网/QQ群/小红书；Android 用户允许未知来源，装完输入兑换码即可。旧 `release/` APK 是 BYOK 版，不再对应新 UI。
2. **Google Play（海外）**：$25 注册开发者，上传 `release/whale-memory-1.0.0.aab`，填 Data safety / 内容分级 / 隐私政策 URL。新个人账号通常还要 12 人 × 14 天封闭测试。
3. **App Store（海外）**：$99/年，TestFlight 先发；AI 陪伴/角色扮演通常 17+，需要举报/屏蔽/UGC 审核。
4. **中国大陆商店**：需要公司主体、软著、ICP 备案、安全评估、算法备案、AIGC 备案、未成年人保护；个人开发者基本走不通。详见 `store-checklist.md`。

## 重要提醒

- 消费端只显示兑换码和剩余次数；模型/API key 设置已删除。
- 托管版必须在构建时传入公网 HTTPS gateway。
- 隐私政策里的 `[运营者]`、`[联系邮箱]` 必须替换，并托管成可公开访问的 URL（GitHub Pages / 自己的域名）。
- 商店文案不要写“无限制/无审查/成人内容”；这类应用会被直接拒。
- 正式上架前补：举报/屏蔽、年龄门、未成年人模式、AI 生成内容标识。
