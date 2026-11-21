# 托管额度模式（免 API key）

这是「用户在你这里买额度、不用自己找 API key」的实现。

## 组成

- `server/billing.mjs`：SQLite 账户 / 兑换码 / 用量。
- `server/gateway.mjs`：`/api/redeem`、`/api/balance`、托管 `/api/chat`。
- `scripts/codes.mjs`：生成/查看兑换码。
- App 设置页只剩「鲸忆额度 / 关于」：兑换码、剩余次数；聊天页没额度时直接显示兑换框。

## 本地跑通

```powershell
# 1. 生成兑换码（默认 data/billing.db）
node scripts/codes.mjs create --credits 500 --count 5

# 2. 启动 gateway（需要 .env 里的 DEEPSEEK_API_KEY）
node server/gateway.mjs

# 3. 构建 Web（托管模式需要 gateway 地址）
cd web
$env:VITE_DIRECT_DEEPSEEK='false'
$env:VITE_API_BASE='http://127.0.0.1:8787'
npm.cmd run build
```

打开 App → 输入兑换码（聊天页或设置页都可以）→ 聊天。每轮扣 1 次；上游失败会退回。
余额不足时再输入新兑换码，会加到同一个 account token，不会丢余额。

## 兑换码

```powershell
# 生成 20 个 500 次的码到文件
node scripts/codes.mjs create --credits 500 --count 20 --out codes-500.txt

# 查看统计
node scripts/codes.mjs stats

# 查看最近码
node scripts/codes.mjs list --limit 20

# 给某个 account token 加额度
node scripts/codes.mjs add --token whale_xxx --credits 500
```

- 一个码只能用一次，兑换后生成一个 `whale_...` account token。
- token 存在用户设备，丢了无法找回；MVP 可接受。
- `data/billing.db` 已在 `.gitignore`，**要备份**。

## 卖码流程

1. 在爱发电 / 微店上架「鲸忆 500 次」。
2. 用户付款后，把 `codes-500.txt` 里的一条发给对方。
3. 用户在 App 里兑换。
4. 每周跑 `stats` 对账；API 成本看 DeepSeek 账单。

不需要先接微信/支付宝 API；这是最快验证付费的方式。

## 部署到公网（VPS）

托管模式必须 HTTPS，`127.0.0.1` 只适合本地测试。

```bash
# 服务器上
git clone <repo> && cd whale-memory
npm install
cd web && npm install && npm run build && cd ..
# .env 只放服务端 key
echo 'DEEPSEEK_API_KEY=sk-...' > .env
node server/gateway.mjs
```

Caddy 反代（自动 HTTPS）：

```
gateway.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

systemd：

```ini
[Unit]
Description=Whale Memory Gateway
After=network.target

[Service]
WorkingDirectory=/opt/whale-memory
Environment=BILLING_DB=/opt/whale-memory/data/billing.db
ExecStart=/usr/bin/node server/gateway.mjs
Restart=always

[Install]
WantedBy=multi-user.target
```

然后构建托管版 App：

```powershell
cd web
$env:VITE_DIRECT_DEEPSEEK='false'
$env:VITE_API_BASE='https://gateway.example.com'
npm.cmd run build
npx.cmd cap sync android
cd android
.\gradlew.bat assembleRelease
```

## 上线前必须补

- **限流**：按 account token 每分钟/每天限制；当前没有。
- **监控**：每日用量、异常账号、余额为 0 的请求。
- **内容审核**：举报/屏蔽、敏感词、未成年人模式。
- **支付/退款/发票**：先用兑换码可手工处理，规模大了要接商户号。
- **备份**：`billing.db` 和 keystore 分开备份。
- **账号 token 泄露**：token 是 bearer，泄露等于额度被盗；后续可加设备绑定/刷新 token。

## 平台规则

- 直接发 APK：可以用兑换码/微信/支付宝。
- Google Play：数字额度必须用 Google Play Billing，不能引导外部支付。
- App Store：必须用 Apple IAP。
- 国内商店：需要公司主体、软著、ICP、安全评估、算法/AIGC 备案。

## 当前限制

- 一个 account token 对应一个额度账户，没有手机号/邮箱登录。
- 兑换码是明文存在 SQLite，管理员要保护 `data/billing.db`。
- 没有自动发码；爱发电/微店需要手动或脚本发码。
- 托管请求失败会退款 1 次；流式中途断开会照常扣费（上游已产生成本）。
