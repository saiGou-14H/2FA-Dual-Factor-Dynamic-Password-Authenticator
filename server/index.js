'use strict';
/**
 * 云端同步后端 —— 服务端只见密文，永不接触明文
 *
 * 基础同步：
 *   POST /api/vault   上传密文  { data, rev }
 *   GET  /api/vault   下载密文  -> { data, rev, updated_at }
 *   GET  /api/health  健康检查
 *
 * 账号迁移（二维码）：
 *   POST /api/migrate/issue  生成一次性迁移令牌 + 二维码  { dek }
 *   POST /api/migrate/claim  新账号凭令牌领取密文  { token }
 *
 * 鉴权：openid 由云托管网关注入（wx.cloud.callContainer 调用时）
 */
const express = require('express');
const mysql = require('mysql2/promise');
const QRCode = require('qrcode');
const nodeCrypto = require('crypto');

const app = express();
app.use(express.json({ limit: '2mb' }));

// 云托管内 MySQL：环境变量 MYSQL_ADDRESS（格式 host:port）+ MYSQL_USERNAME + MYSQL_PASSWORD
const { MYSQL_USERNAME, MYSQL_PASSWORD, MYSQL_ADDRESS } = process.env;
const [dbHost, dbPort] = (MYSQL_ADDRESS || '').split(':');

const pool = mysql.createPool({
  host: dbHost || '127.0.0.1',
  port: Number(dbPort) || 3306,
  user: MYSQL_USERNAME || 'root',
  password: MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'nodejs_demo',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
});

// 迁移令牌有效期：5 分钟
const MIGRATE_TTL_MS = 5 * 60 * 1000;
// 迁移 URL 前缀
const MIGRATE_SCHEME = 'otpmig://migrate';

async function ensureSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS vault (
      openid VARCHAR(64) NOT NULL PRIMARY KEY,
      data LONGTEXT NOT NULL,
      rev INT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS profile (
      openid VARCHAR(64) NOT NULL PRIMARY KEY,
      nickname VARCHAR(64) NOT NULL DEFAULT '',
      avatar LONGTEXT,
      updated_at BIGINT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS migrate_token (
      token VARCHAR(64) NOT NULL PRIMARY KEY,
      source_openid VARCHAR(64) NOT NULL,
      expires_at BIGINT NOT NULL,
      used TINYINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

/** 鉴权：openid 由云托管网关注入 */
function auth(req, res, next) {
  const openid = req.headers['x-wx-openid'] || req.headers['x-wx-unionid'] || '';
  if (!openid) return res.status(401).json({ code: 401, error: 'unauthorized' });
  req.openid = openid;
  next();
}

app.get('/api/health', (req, res) => res.json({ code: 0, ok: true, ts: Date.now() }));

/* ==================== 基础同步 ==================== */

// 上传密文：只存字符串，绝不解析/解密
app.post('/api/vault', auth, async (req, res) => {
  try {
    const data = (req.body && req.body.data) || '';
    const rev = Number((req.body && req.body.rev)) || 0;
    if (typeof data !== 'string' || !data) {
      return res.status(400).json({ code: 400, error: 'data required' });
    }
    if (data.length > 500000) {
      return res.status(413).json({ code: 413, error: 'payload too large' });
    }
    await pool.query(
      'INSERT INTO vault (openid, data, rev, updated_at) VALUES (?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE data = VALUES(data), rev = VALUES(rev), updated_at = VALUES(updated_at)',
      [req.openid, data, rev, Date.now()]
    );
    res.json({ code: 0, ok: true });
  } catch (e) {
    console.error('[vault put]', e);
    res.status(500).json({ code: 500, error: 'server error' });
  }
});

// 下载密文
app.get('/api/vault', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT data, rev, updated_at FROM vault WHERE openid = ?',
      [req.openid]
    );
    if (!rows.length) return res.json({ code: 0, data: null });
    res.json({
      code: 0,
      data: rows[0].data,
      rev: rows[0].rev,
      updated_at: rows[0].updated_at
    });
  } catch (e) {
    console.error('[vault get]', e);
    res.status(500).json({ code: 500, error: 'server error' });
  }
});

/* ==================== 零配置密钥找回（openid + 服务端密钥派生） ==================== */

// VAULT_SECRET 只存在于环境变量，绝不入库。
// KEK = HMAC-SHA256(VAULT_SECRET, openid)，同一账号恒定，换设备/重装都能重新取回。
// 安全边界：数据库单独泄露时攻击者没有 VAULT_SECRET，解不开；
// 但本服务与云平台可推导 KEK，因此这是「服务端可解密」模型，不是端到端加密。
const VAULT_SECRET = process.env.VAULT_SECRET || '';

// 弱密钥告警：KEK 全靠它，短口令/字典词等于没有保护
(function warnWeakSecret() {
  if (!VAULT_SECRET) {
    console.warn('[wrap-key] VAULT_SECRET 未配置，零配置密钥找回不可用');
    return;
  }
  if (VAULT_SECRET.length < 16) {
    console.warn(
      '[wrap-key] VAULT_SECRET 过短（' + VAULT_SECRET.length + ' 位）。' +
      '数据库泄露时可被字典攻击还原，建议 32 位以上随机串。'
    );
  }
})();

app.get('/api/wrap-key', auth, (req, res) => {
  if (!VAULT_SECRET) {
    return res.status(503).json({ code: 503, error: 'VAULT_SECRET not configured' });
  }
  const kek = nodeCrypto.createHmac('sha256', VAULT_SECRET).update(req.openid).digest('hex');
  res.json({ code: 0, kek: kek });
});

/* ==================== 身份资料（明文，便于重装后恢复） ==================== */

// 上传头像昵称（明文存储：属于微信公开资料，非密钥）
app.post('/api/profile', auth, async (req, res) => {
  try {
    const nickname = String((req.body && req.body.nickname) || '').slice(0, 64);
    const avatar = String((req.body && req.body.avatar) || '');
    if (avatar.length > 200000) {
      return res.status(413).json({ code: 413, error: 'avatar too large' });
    }
    await pool.query(
      'INSERT INTO profile (openid, nickname, avatar, updated_at) VALUES (?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE nickname = VALUES(nickname), avatar = VALUES(avatar), updated_at = VALUES(updated_at)',
      [req.openid, nickname, avatar, Date.now()]
    );
    res.json({ code: 0, ok: true });
  } catch (e) {
    console.error('[profile put]', e);
    res.status(500).json({ code: 500, error: 'server error' });
  }
});

// 拉取头像昵称（重装小程序后自动恢复身份）
app.get('/api/profile', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT nickname, avatar, updated_at FROM profile WHERE openid = ?',
      [req.openid]
    );
    if (!rows.length) return res.json({ code: 0, nickname: '', avatar: '' });
    res.json({
      code: 0,
      nickname: rows[0].nickname || '',
      avatar: rows[0].avatar || '',
      updated_at: rows[0].updated_at
    });
  } catch (e) {
    console.error('[profile get]', e);
    res.status(500).json({ code: 500, error: 'server error' });
  }
});

/* ==================== 账号迁移 ==================== */

/**
 * 生成一次性迁移令牌 + 二维码
 * body: { dek } —— 设备端密钥（hex）。服务端不保存它，只编码进二维码。
 */
app.post('/api/migrate/issue', auth, async (req, res) => {
  try {
    const dek = (req.body && req.body.dek) || '';
    if (typeof dek !== 'string' || !/^[0-9a-fA-F]{16,128}$/.test(dek)) {
      return res.status(400).json({ code: 400, error: 'invalid dek' });
    }

    const token = nodeCrypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + MIGRATE_TTL_MS;

    // 清理过期令牌，避免表膨胀
    await pool.query('DELETE FROM migrate_token WHERE expires_at < ?', [Date.now()]);
    await pool.query(
      'INSERT INTO migrate_token (token, source_openid, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)',
      [token, req.openid, expiresAt, Date.now()]
    );

    const payload = MIGRATE_SCHEME + '?t=' + token + '&k=' + dek;
    const qr = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 520,
      color: { dark: '#101418ff', light: '#ffffffff' }
    });

    res.json({
      code: 0,
      token: token,
      expiresAt: expiresAt,
      payload: payload,
      qr: qr
    });
  } catch (e) {
    console.error('[migrate issue]', e);
    res.status(500).json({ code: 500, error: 'server error' });
  }
});

/**
 * 新账号凭令牌领取密文：把源账号的 vault 复制到当前 openid
 * body: { token }
 */
app.post('/api/migrate/claim', auth, async (req, res) => {
  try {
    const token = String((req.body && req.body.token) || '');
    if (!/^[0-9a-f]{32}$/.test(token)) {
      return res.status(400).json({ code: 400, error: 'invalid token' });
    }

    const [rows] = await pool.query(
      'SELECT token, source_openid, expires_at, used FROM migrate_token WHERE token = ?',
      [token]
    );
    if (!rows.length) return res.status(404).json({ code: 404, error: 'token not found' });

    const row = rows[0];
    if (row.used) return res.status(410).json({ code: 410, error: 'token already used' });
    if (Number(row.expires_at) < Date.now()) {
      return res.status(410).json({ code: 410, error: 'token expired' });
    }
    if (row.source_openid === req.openid) {
      return res.status(400).json({ code: 400, error: 'same account' });
    }

    const [srcRows] = await pool.query(
      'SELECT data, rev FROM vault WHERE openid = ?',
      [row.source_openid]
    );
    if (!srcRows.length) return res.status(404).json({ code: 404, error: 'no data in source account' });

    // 复制到新账号（覆盖）
    await pool.query(
      'INSERT INTO vault (openid, data, rev, updated_at) VALUES (?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE data = VALUES(data), rev = VALUES(rev), updated_at = VALUES(updated_at)',
      [req.openid, srcRows[0].data, Number(srcRows[0].rev) || 0, Date.now()]
    );

    // 令牌一次性使用
    await pool.query('UPDATE migrate_token SET used = 1 WHERE token = ?', [token]);

    res.json({ code: 0, ok: true });
  } catch (e) {
    console.error('[migrate claim]', e);
    res.status(500).json({ code: 500, error: 'server error' });
  }
});

const port = Number(process.env.PORT) || 80;
ensureSchema()
  .then(() => {
    app.listen(port, () => console.log('otp-sync listening on ' + port));
  })
  .catch((e) => {
    console.error('schema init failed', e);
    process.exit(1);
  });
