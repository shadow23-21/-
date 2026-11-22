# 确保兑换码一定能兑换：上线前检查表

兑换失败只有两个原因：

1. App 里的 gateway 地址不是生产地址。
2. 生产 gateway 的 `BILLING_DB` 里没有这个码，或码的额度/天数和文件不一致。

按下面顺序做，任何一步不过都不要上架/发码。

## 0. 先确认生产 gateway

```bash
curl https://你的域名/api/health
```

返回 `ok: true` 才算通。

## 1. 确认 gateway 用的是哪个数据库

```bash
docker compose exec gateway printenv BILLING_DB
```

应该是持久化卷上的路径，例如 `/data/billing.db`。  
如果没设置，默认是 `data/billing.db`，重启可能丢。

## 2. 最稳：在生产环境直接生成码

不要在本机生成再搬。直接在生产容器里生成：

```bash
# 11 个 9.9 轻量月包
docker compose exec gateway \
  node scripts/codes.mjs create --plan monthly9 --count 11 --out /tmp/codes-monthly9-11.txt

# 把文件取回本机
docker compose exec gateway cat /tmp/codes-monthly9-11.txt > codes-monthly9-11.txt
```

这样文件里的码 100% 在生产库里。

## 3. 如果已经在本机生成了，导入生产库

```bash
docker compose cp release/codes-monthly9-11.txt gateway:/tmp/codes.txt

docker compose exec gateway \
  node scripts/codes.mjs import --file /tmp/codes.txt --credits 1200 --days 30
```

- `--credits 1200 --days 30` 必须和套餐一致。
- 9.9 轻量月包：1200 次 / 30 天
- 19.9 标准月包：3000 次 / 30 天
- 29.9 畅聊月包：5000 次 / 30 天
- 随心包：300 次 / `--days 0`

## 4. 校验（必须 ok: true）

```bash
docker compose exec gateway \
  node scripts/codes.mjs verify --file /tmp/codes.txt --credits 1200 --days 30
```

期望：

```json
{
  "total": 11,
  "ok": true,
  "missing": [],
  "used": [],
  "mismatch": []
}
```

- `missing`：生产库没有这个码 → 没导入/导错 DB。
- `used`：码已被兑换 → 不能卖。
- `mismatch`：额度或天数不对 → 导入参数错了。
- 只要 `ok: false`，就不要上传这个文件。

## 5. 用测试码走一遍真实兑换

拿一个**专用的测试码**（不要用要卖的那 11 个）：

```bash
curl -s -X POST https://你的域名/api/redeem \
  -H 'Content-Type: application/json' \
  -d '{"code":"WHALE-TEST-CODE"}'
```

期望返回：

```json
{"token":"whale_...","credits":1200,"expiresAt":"..."}
```

再查余额：

```bash
curl -s https://你的域名/api/balance \
  -H "Authorization: Bearer whale_..."
```

应该是 1200，并且有 `expiresAt`。

再发一条托管聊天：

```bash
curl -N -X POST https://你的域名/api/chat \
  -H "Authorization: Bearer whale_..." \
  -H 'Content-Type: application/json' \
  -d '{"managed":true,"provider":"deepseek","model":"deepseek-flash","messages":[{"role":"user","content":"你好"}],"maxTokens":50}'
```

能看到 `data: ...` 流就说明兑换 + 扣费 + 模型链路全通。

## 6. 用正式 APK 再走一遍

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-release.ps1 -GatewayUrl https://你的域名
```

- 把 `release/whale-memory-1.0.0.apk` 装到**另一台手机**。
- 输入测试码 → 看到「剩余 1200 次 · 到期日」→ 发一条消息。
- 成功后再上传销售码。

## 7. 备份

```bash
docker compose exec gateway cp /data/billing.db /data/billing.db.backup-$(date +%Y%m%d)
```

`billing.db` 丢了，所有用户余额和未兑换码都没了。

## 8. 最后才上传闲鱼

- 只上传 `verify` 为 `ok: true` 的文件。
- 一个码只发一次；卖掉的码从库存文件里删掉，避免重复发。
- 前 10 个体验码用 `release/codes-trial10.txt`，不要和销售码混。
- 每个月包码从兑换时刻起 30 天，不是从生成时刻。
