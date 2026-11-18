# 2FA 动态密码验证器

本地优先的 TOTP/HOTP 两步验证小程序，支持端到端加密云端同步。

## 目录

```
app/     微信小程序（原生，零第三方 UI 依赖）
server/  云同步后端（Express + MySQL，服务端仅存密文）
```

## 功能

- TOTP / HOTP 验证码（RFC 4226 / 6238，SHA1 / SHA256）
- `otpauth://` 二维码扫描导入、手动录入
- 分组管理、搜索、藏码、复制
- 本地加密存储（PBKDF2 + AES-256-CBC + HMAC）
- 云端同步（端到端加密，服务端只见密文）

## 小程序

```bash
cd app
npm install          # 安装 crypto-js
```

微信开发者工具导入 `app/`，工具 → 构建 npm。

## 后端

`server/` 是云托管（CloudBase Run）部署包，含 `index.js` + `package.json` + `Dockerfile`。

接口：

```
POST /api/vault   存密文 { data, rev }
GET  /api/vault   取密文 -> { data, rev, updated_at }
GET  /api/health  健康检查
```

服务端只存密文字符串，**不做任何解密**——口令在设备端派生密钥，TOTP 种子永不出设备。

## 安全模型

```
口令 → PBKDF2(10万次) → KEK（不出设备）
随机 DEK → AES-256-CBC 加密保险库
DEK 用 KEK 包裹后随密文上传
```

忘记口令 = 数据不可恢复（端到端加密的代价）。
