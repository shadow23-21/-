# 把 gateway 放上公网

托管兑换码必须有公网 HTTPS gateway；微店只负责发码。

## 方案 A：Railway / Zeabur（最省事，不用管服务器）

适合不想碰 Linux 的人。费用大约每月几美元/几十元人民币。

1. 把仓库推到 GitHub（已推）。
2. 在 Railway / Zeabur 新建项目 → Deploy from GitHub → 选这个仓库。
3. 它会自动识别根目录的 `Dockerfile`。
4. 添加环境变量：
   - `DEEPSEEK_API_KEY=sk-...`
   - `HOST=0.0.0.0`
   - `BILLING_DB=/data/billing.db`
5. 添加一个持久化 Volume，挂载到 `/data`（**必须**，否则兑换码/余额重启就没了）。
6. 在平台里生成一个公网域名，例如 `https://whale-memory.up.railway.app`。
7. 打开 `https://你的域名/api/health`，看到 `ok: true` 即可。

然后构建正式 APK：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-release.ps1 -GatewayUrl https://你的域名
```

把 `release/codes-3000.txt` 导入生产库（如果容器里是新 DB）：

```bash
node scripts/codes.mjs import --file release/codes-3000.txt --credits 3000
```

或者在平台终端里直接生成：

```bash
node scripts/codes.mjs create --credits 3000 --count 20
```

## 方案 B：自己的 VPS（最可控）

一台 1 核 1G 的轻量云服务器就够；需要域名。

```bash
# Ubuntu 安装 Docker
curl -fsSL https://get.docker.com | sh

git clone https://github.com/shadow23-21/-.git whale-memory
cd whale-memory
printf 'DEEPSEEK_API_KEY=sk-...\n' > .env
docker compose up -d
```

Caddy 反向代理 + 自动 HTTPS：

```
gw.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

- 域名 A 记录指向服务器 IP。
- Caddy 自动申请证书。
- 防火墙只开 80/443。
- 数据在 Docker volume `whale-data`，备份它。

## 方案 C：Cloudflare Tunnel（本机临时验证）

适合先测试，不适合长期卖：

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

会得到一个 `https://xxx.trycloudflare.com` 临时地址，电脑关机就失效。只用于验证兑换流程。

## 兑换码

```bash
# 在 gateway 所在环境执行
node scripts/codes.mjs create --credits 3000 --count 20 --out codes-3000.txt
node scripts/codes.mjs stats
node scripts/codes.mjs import --file codes-3000.txt --credits 3000
```

- 码存在 `BILLING_DB` 指向的 SQLite 里；换服务器要一起迁移/导入。
- 一个码只能用一次；再买新码会累加到同一个 account token。
- 微店自动发货：把码作为卡密上传，一单一码。

## 检查清单

- [ ] `https://域名/api/health` 返回 `ok: true`
- [ ] `BILLING_DB` 在持久化卷上
- [ ] 手机能打开 `https://域名/`
- [ ] App 兑换码成功、余额减少
- [ ] `data/billing.db` 有备份
- [ ] 配好限流/内容审核（上线前）
