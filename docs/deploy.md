# 把 gateway 放上公网

托管兑换码必须有公网 HTTPS gateway；微店只负责发码。

## 方案 A：Railway（推荐）

> **不要用 Zeabur**：官方公告已说明 2026/12/31 停止运营，部分服务 12/1 起停止。  
> 用 Railway：支持 Dockerfile、持久化 Volume、自动 HTTPS。

1. 仓库已在 GitHub；根目录有 `Dockerfile` 和 `railway.json`。
2. 打开 `https://railway.app/`，用 GitHub 登录。
3. **New Project → Deploy from GitHub repo**，选 `shadow23-21/-`。
4. Railway 会自动按 `railway.json` 用 Dockerfile 构建。
5. 环境变量：
   - `DEEPSEEK_API_KEY=sk-...`
   - `HOST=0.0.0.0`
   - `BILLING_DB=/data/billing.db`
6. 添加 Volume，挂载到 `/data`（**必须**，否则重启丢余额/码）。
7. Settings → Networking → **Generate Domain**，得到 `https://xxx.up.railway.app`。
8. 打开 `https://xxx.up.railway.app/api/health`，看到 `ok: true`。
9. 在这个生产环境生成兑换码，不要在本机生成后再搬。

Railway 终端里：

```bash
node scripts/codes.mjs create --plan monthly19 --count 20 --out codes-monthly19.txt
node scripts/codes.mjs verify --file codes-monthly19.txt --credits 3000 --days 30
```

`verify` 必须 `ok: true`，再上架。

然后构建正式 APK：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-release.ps1 -GatewayUrl https://你的域名
```

## 方案 B：自己的 VPS（最可控）

一台 1 核 1G 的轻量云服务器就够；需要域名。

1. 在阿里云/腾讯云/Cloudflare 买一个域名（`.com` 约 ¥30–80/年）。
2. 域名 DNS 添加 A 记录：`gw` → 服务器公网 IP。
3. 等解析生效（`ping gw.example.com` 能看到 IP）。

```bash
# Ubuntu 安装 Docker
curl -fsSL https://get.docker.com | sh

git clone https://github.com/shadow23-21/-.git whale-memory
cd whale-memory
printf 'DEEPSEEK_API_KEY=sk-...\n' > .env
docker compose up -d

# Caddy 反向代理 + 自动 HTTPS
sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`：

```
gw.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

```bash
sudo systemctl reload caddy
curl https://gw.example.com/api/health
```

- 防火墙只开 80/443。
- 数据在 Docker volume `whale-data`，备份它。
- 域名没备案也能用海外服务器；国内服务器需要备案。

## 方案 C：Cloudflare Tunnel（本机临时验证）

适合先测试，不适合长期卖：

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

会得到一个 `https://xxx.trycloudflare.com` 临时地址，电脑关机就失效。只用于验证兑换流程。

## 兑换码

```bash
# 在 gateway 所在环境执行（生产库）
node scripts/codes.mjs create --plan monthly19 --count 20 --out codes-monthly19.txt
node scripts/codes.mjs verify --file codes-monthly19.txt --credits 3000 --days 30
node scripts/codes.mjs stats
```

- 码存在 `BILLING_DB` 指向的 SQLite 里；换服务器要一起迁移/导入。
- 一个码只能用一次；再买新码会累加到同一个 account token。
- 月包 30 天有效；`verify` 必须 `ok: true` 才能上架。
- 微店自动发货：把码作为卡密上传，一单一码。

## 检查清单

- [ ] `https://域名/api/health` 返回 `ok: true`
- [ ] `BILLING_DB` 在持久化卷上
- [ ] 手机能打开 `https://域名/`
- [ ] App 兑换码成功、余额减少
- [ ] `data/billing.db` 有备份
- [ ] 配好限流/内容审核（上线前）
