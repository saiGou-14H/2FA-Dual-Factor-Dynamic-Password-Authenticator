'use strict';
/**
 * 云端同步后端 —— 服务端只见密文，永不接触明文
 * API:
 *   POST /api/vault   上传密文  { data, rev }
 *   GET  /api/vault   下载密文  -> { data, rev, updated_at }
 *   GET  /api/health  健康检查
 *
 * 鉴权：openid 由云托管网关注入（wx.cloud.callContainer 调用时）
 * 数据库：MySQL（环境变量注入，兜底用默认值）
 */
const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json({ limit: '2mb' }));

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || process.env.MYSQL_DB || 'wxcloudrun',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
});

async function ensureSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS vault (
      openid VARCHAR(64) NOT NULL PRIMARY KEY,
      data LONGTEXT NOT NULL,
      rev INT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0
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

const port = Number(process.env.PORT) || 80;
ensureSchema()
  .then(() => {
    app.listen(port, () => console.log('otp-sync listening on ' + port));
  })
  .catch((e) => {
    console.error('schema init failed', e);
    process.exit(1);
  });
