# 验证器小程序（app）

原生微信小程序，2FA 二步验证器（TOTP/HOTP）。零第三方 UI 依赖，仅一个运行时依赖 `crypto-js`。

## 运行

```bash
npm install          # 安装 crypto-js
```

微信开发者工具导入本目录 → 工具 → **构建 npm** → 编译。

> `构建 npm` 是必须步骤，否则 `require('crypto-js')` 失败，设置页云同步会显示「未就绪」。

## 目录

```
app.js / app.json / app.wxss     全局（wx.cloud.init、onHide 自动同步、CSS 图标库）
components/otp-card/             验证码卡片（环形倒计时、翻牌动效、复制/显示）
pages/
  index/     列表（分组 tab、搜索、藏码、复制、移动分组、FAB 添加）
  input/     添加/编辑账号（分组置顶、扫码预填）
  groups/    分组管理（改名、排序、删除并迁移）
  recycle/   回收站（按删除日期范围筛选、恢复、彻底删除）
  settings/  设置（云同步、迁移二维码、回收站入口、导出）
  export/    导出备份（JSON + otpauth 链接）
utils/
  totp.js       SHA1/SHA256 + HMAC + Base32 + HOTP/TOTP（纯 JS）
  otpauth.js    otpauth:// 解析与生成
  store.js      本地存储（软删除、回收站、分组）
  crypto.js     AES-256-CBC + HMAC（随机数走 wx.getRandomValues）
  vault.js      免口令密钥（DEK）管理
  sync.js       同步编排（push / pull）
  cloud-sync.js 云托管接口封装（含迁移 issue/claim）
  util.js       时间格式化、导航栏度量
```

## 关键约定

- **随机数**：只用 `wx.getRandomValues`（异步）。不要用 `crypto-js` 的 `WordArray.random()`，
  开发者工具模拟器缺原生 crypto 模块会报错。
- **身份**：`openid` 由云托管网关注入，前端不需要登录接口。
- **同步时机**：`App.onHide` 静默上传；设置页可手动同步。
- **密钥**：DEK 存 `otp_dek_hex`，换机靠迁移二维码携带。
- **删除**：软删除（`deletedAt`）进回收站，可按时间找回；`purge` 才物理删除。
- **图标**：全部 CSS 绘制，跨端一致。显示/隐藏图标有两种风格：
  `ico-eye`（杏仁眼，默认）、`ico-eye-b`（胶囊开关），改 wxml 的 class 即可切换。

## 相关文档

- 项目总览：`../README.md`
- 同步与迁移设计：`../docs/同步与迁移.md`
- 后端部署：`../server/README.md`
