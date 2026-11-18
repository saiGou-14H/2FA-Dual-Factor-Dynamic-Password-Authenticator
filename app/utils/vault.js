'use strict';
/**
 * vault.js —— 免口令的加密保险库（身份 = 微信 openid）
 *
 * 密钥模型：
 *   首次使用生成 32 字节随机 DEK，存本机（otp_dek_hex）
 *   保险库用 DEK 加密后上传；服务端只见密文
 *   换机时通过「迁移二维码」把 DEK 带过去（一次性令牌，5 分钟有效）
 *
 * 安全边界：DEK 存本机存储，等同于「拿到这台设备即可解密」。
 * 这是免口令方案的固有代价，已在项目文档中说明。
 */
var crypto = require('./crypto.js');
var store = require('./store.js');

var DEK_KEY = 'otp_dek_hex';

/** 读取本机 DEK（hex），没有返回空串 */
function getDekHex() {
  try { return wx.getStorageSync(DEK_KEY) || ''; } catch (e) { return ''; }
}

/** 写入 DEK（hex） */
function setDekHex(hex) {
  wx.setStorageSync(DEK_KEY, String(hex || ''));
}

/** 是否已初始化密钥 */
function hasDek() {
  return !!getDekHex();
}

/** 确保有 DEK：没有就生成一个（异步） */
function ensureDek() {
  return new Promise(function (resolve, reject) {
    var existing = getDekHex();
    if (existing) return resolve(existing);
    if (!crypto.available) return reject({ errMsg: '请先构建 npm' });
    crypto.randomHex(32).then(function (hex) {
      setDekHex(hex);
      resolve(hex);
    }).catch(reject);
  });
}

/** 当前本地数据 → 密文包字符串（含回收站，跨设备一致） */
function encryptCurrent(dekHex) {
  var key = crypto.hexKey(dekHex);
  if (!key) return Promise.reject({ errMsg: '密钥无效' });
  return crypto.encryptVault(key, {
    tokens: store.all(),
    groups: store.groups()
  }).then(function (body) {
    return JSON.stringify({ v: 1, body: body });
  });
}

/** 密文包字符串 + DEK → 写回本地，返回 token 数量 */
function applyPacked(packedStr, dekHex) {
  var key = crypto.hexKey(dekHex);
  if (!key) throw new Error('密钥无效');
  var packed;
  try { packed = JSON.parse(packedStr); } catch (e) { throw new Error('数据格式错误'); }
  if (!packed || !packed.body) throw new Error('数据为空');

  var vault = crypto.decryptVault(key, packed.body);
  if (!vault || !Array.isArray(vault.tokens)) {
    throw new Error('解密失败（密钥不匹配）');
  }
  store.replaceAll(vault.tokens, vault.groups || []);
  return vault.tokens.length;
}

module.exports = {
  DEK_KEY: DEK_KEY,
  getDekHex: getDekHex,
  setDekHex: setDekHex,
  hasDek: hasDek,
  ensureDek: ensureDek,
  encryptCurrent: encryptCurrent,
  applyPacked: applyPacked
};
