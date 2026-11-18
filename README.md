# 云同步后端部署说明

## 已部署信息

| 项 | 值 |
|---|---|
| 环境 env | `prod-d6gfcpp9vba4f1ae4` |
| 服务名 | `express-w3rv` |
| 公网域名 | `https://express-w3rv-350067-13-1310828421.sh.run.tcloudbase.com` |
| 数据库 | MySQL（账号 root，密码见服务通知） |

## 一、后端：替换模板代码

模板现在是计数器（`/api/count`），把它替换成本目录的 vault 密文存取：

1. 云托管控制台 → 服务 `express-w3rv` → 代码编辑（或在线 IDE）
2. 用 `server/index.js` 替换入口文件，`server/package.json` 替换依赖声明
3. 重新部署（保存后云托管会自动构建）

### MySQL 连接

`index.js` 默认从环境变量读取连接信息（云托管会自动注入）。若未注入，在云托管控制台配置环境变量：

```
MYSQL_HOST      数据库内网地址
MYSQL_PORT      3306
MYSQL_USER      root
MYSQL_PASSWORD  服务通知里的密码
MYSQL_DATABASE  库名（通常 wxcloudrun）
```

vault 表会在后端启动时**自动创建**，无需手动建表。

## 二、客户端：装依赖 + 构建

1. 在 `app` 目录执行：
   ```bash
   npm install crypto-js
   ```
2. 微信开发者工具 → 工具 → 构建 npm
3. 确认 `utils/cloud-sync.js` 里的 env / service 与上面一致（已预填）

## 三、使用流程

| 场景 | 操作 |
|---|---|
| 首次开启 | 设置页 → 云同步 →「开启云同步」→ 设口令 → 自动加密上传 |
| 日常同步 | 设置页 →「立即同步」 |
| 换机恢复 | 新设备设置页 →「从云端恢复」→ 输入同一口令 → 下载解密写回 |

## 安全模型

- 口令在设备端经 PBKDF2(10万次) 派生 KEK，**不出设备**
- 随机 DEK 加密保险库，DEK 被 KEK 包裹后随密文上传
- 服务端只存 `data`（密文字符串），**无法解密**，拖库也看不到 TOTP 种子
- 忘记口令 = 数据不可恢复（这是端到端加密的代价，非 bug）

## 验证

部署后访问健康检查：

```
curl https://express-w3rv-350067-13-1310828421.sh.run.tcloudbase.com/api/health
```

应返回 `{"code":0,"ok":true,...}`。
