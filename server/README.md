# 云同步后端部署说明

服务端**只存密文**，不做任何加解密。数据按微信 `openid` 隔离。

## 已部署信息

| 项 | 值 |
|---|---|
| 环境 env | `prod-d6gfcpp9vba4f1ae4` |
| 服务名 | `express-w3rv` |
| 公网域名 | `https://express-w3rv-350067-13-1310828421.sh.run.tcloudbase.com` |
| 数据库 | MySQL 5.7，内网 `10.23.109.178:3306` |

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| POST | `/api/vault` | 上传密文 `{ data, rev }` |
| GET | `/api/vault` | 下载密文 → `{ data, rev, updated_at }` |
| POST | `/api/migrate/issue` | 生成迁移令牌 + 二维码 `{ dek }` |
| POST | `/api/migrate/claim` | 新账号领取密文 `{ token }` |

### 迁移机制

1. 旧账号 `POST /api/migrate/issue`，服务端生成 32 位 hex 令牌（5 分钟有效、一次性），
   把 `otpmig://migrate?t=<token>&k=<dek>` 渲染成二维码 PNG（dataURI）返回。
2. 新账号扫码解析出 `token` 与 `dek`，调用 `POST /api/migrate/claim`。
3. 服务端把源 openid 的 `vault.data` 复制到新 openid，令牌置为已用。
4. 新设备用二维码里的 `dek` 解密下载到的密文。

服务端**不保存 dek**，它只存在于二维码里。

## 环境变量

云托管自动注入：

```
MYSQL_ADDRESS    10.23.109.178:3306
MYSQL_USERNAME   root
MYSQL_PASSWORD   （服务通知里的密码）
```

库名默认 `nodejs_demo`。表 `vault`、`migrate_token` 启动时自动创建。

## 部署

仓库根目录 `Dockerfile` 构建 `server/`；或用 `backend` 分支（根目录即后端）直接部署。

依赖：`express`、`mysql2`、`qrcode`。

## 验证

```bash
curl https://express-w3rv-350067-13-1310828421.sh.run.tcloudbase.com/api/health
# {"code":0,"ok":true,...}
```

本地跑完整流程：

```bash
node tools/test_migrate_e2e.js   # 免口令同步 + 迁移
```

## 注意

- MySQL 开了「自动暂停 10 分钟」，闲置后首次请求需 10–20 秒唤醒。
- 迁移令牌表会在每次 issue 时清理过期行，不会无限增长。

## 许可证

[MIT](../LICENSE) · Copyright (c) 2026 saiGou-14H
