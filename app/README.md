# 验证器（TOTP/HOTP）— 原生小程序前端

一套可直接运行的原生微信小程序前端，内置纯 JS 的 RFC 4226 / 6238 引擎，**零 npm 依赖、零后端**。

## 运行

1. 打开微信开发者工具 →「导入项目」→ 目录选 `D:\xcx\app`
2. AppID 选「测试号」或使用 `project.config.json` 里的 `touristappid`
3. 编译即可看到 3 个示例账号（GitHub / Google / AWS，含一个 SHA256 + 8 位样例）

示例账号只在首次启动时植入，之后删除不会再出现。

## 已实现

| 模块 | 说明 |
|---|---|
| OTP 引擎 | 自研 SHA1 / SHA256 + HMAC + Base32 + HOTP/TOTP，无第三方依赖 |
| 首页 | 卡片列表、每秒刷新、进度条、剩余秒数、<5s 变红、点按显示/隐藏、复制、长按菜单 |
| 添加/编辑 | 扫码（`otpauth://`）、手动录入、服务名/账号/密钥/算法/位数/周期/类型/计数器 |
| 设置 | 默认藏码开关、账号数、清空、本机时间提示 |
| 导出 | JSON 备份 + 每条 `otpauth://` 链接，一键复制 |

## 目录

```
app/
├── app.js / app.json / app.wxss        全局（暗色设计系统 + 示例数据）
├── components/otp-card/                验证码卡片组件
├── pages/
│   ├── index/                          列表（搜索 / 显示切换 / 复制 / 删除）
│   ├── input/                          添加与编辑（含扫码）
│   ├── settings/                       设置
│   └── export/                         导出备份
└── utils/
    ├── totp.js    SHA1/SHA256 + HMAC + Base32 + HOTP/TOTP（纯 JS）
    ├── otpauth.js otpauth:// URI 解析与生成
    ├── store.js   本地存储适配器（**加密层接入点**）
    └── util.js    格式化工具
```

## 验证

工程自带两套离线测试（Node 环境，无需开发者工具）：

```bash
node tools/test_ui_totp.js     # 引擎：SHA1/SHA256/HMAC/Base32 + RFC 4226/6238 官方向量
node tools/test_app_logic.js   # 数据层：CRUD/排序/往返解析/容错（带 wx 桩）
node tools/check_ui.js         # 静态检查：JSON、页面文件、require、组件、事件绑定
```

当前结果：RFC 向量 21/21、逻辑 27/27、静态检查全通过。

## 加密层接入点（重要）

当前 `utils/store.js` 是**明文存储**，仅为把 UI 跑通。接入加密只需替换两个函数，页面代码零改动：

```js
// utils/store.js
// persist(tokens)  -> 改成：JSON → AES-256-CBC/CTR(DEK) + HMAC → 落盘
// restore()        -> 改成：读密文 → 校验 MAC → 解密 → JSON

// 并在 App.onLaunch 注入实现：
store.setCipher({
  encrypt: (obj) => /* 返回密文字符串 */,
  decrypt: (str) => /* 返回对象 */
});
```

正式实现的建议层级（详见项目根目录的 `REPORT.md`、`OSS-功能缺失清单.md`）：

```
口令 → KDF(Argon2id 或 PBKDF2-HMAC-SHA256 ≥20万次) → KEK
     → 解开 wrapped_DEK → DEK（随机 32B，仅内存）
     → AES 加解密保险库
恢复码 → 同样包裹一份 DEK，用于忘记口令时恢复
```

注意：**安全随机必须用 `wx.getRandomValues`**（异步接口）；`store.uuid()` 里的 `Math.random` 只用于记录主键，不参与密钥。

## 未实现（故意留白，避免半成品）

| 项 | 原因 |
|---|---|
| 二维码**生成** | 需要一个 QR 编码器（约 200–400 行或引第三方库）。当前导出用 JSON + otpauth 链接，扫码导入已完整可用 |
| 拖拽排序 | 需要手势或 `movable-view`，`store.reorder()` 已就绪，接上 UI 即可 |
| 云同步 | 属后端范畴，见 `REPORT.md` §6 与云开发方案 |
| 图标/字体 | 用系统字符代替图标，避免引入 197KB 的字体文件 |

## 设计

暗色优先，CSS 变量集中在 `app.wxss` 的 `page` 选择器，改主题只需换那十几个变量。
配色：底 `#0b0f14`、卡片 `#151d29`、主色 `#4f8cff`、告警 `#ff5d5d`。
