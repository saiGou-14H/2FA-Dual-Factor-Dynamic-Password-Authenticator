'use strict';
/**
 * crypto.js —— 端到端加密保险库
 * 口令 → PBKDF2 → KEK → 包裹随机 DEK → AES-256-CBC + HMAC 加密内容
 * 服务端只收到密文，无法解密。口令不出设备。
 *
 * 依赖 crypto-js（纯 JS，小程序可用）：
 *   1. 在 app 目录执行  npm install crypto-js
 *   2. 微信开发者工具 → 工具 → 构建 npm
 */
const CryptoJS = require('crypto-js');

// PBKDF2 迭代次数（10 万次，兼顾安全与低端机速度）
const ITERATIONS = 100000;
// 保险库格式版本
const VAULT_VERSION = 1;

/** 随机字节 → hex 字符串 */
function randomHex(bytes) {
  return CryptoJS.lib.WordArray.random(bytes).toString(CryptoJS.enc.Hex);
}

/** 口令 + 盐 → KEK（256 位） */
function deriveKey(password, saltHex, iterations) {
  return CryptoJS.PBKDF2(password, CryptoJS.enc.Hex.parse(saltHex), {
    keySize: 256 / 32,
    iterations: iterations || ITERATIONS,
    hasher: CryptoJS.algo.SHA256
  });
}

/** AES-256-CBC 加密 + HMAC-SHA256（encrypt-then-MAC） */
function encrypt(plaintext, key) {
  const iv = CryptoJS.lib.WordArray.random(16);
  const cipher = CryptoJS.AES.encrypt(plaintext, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });
  const ivHex = iv.toString(CryptoJS.enc.Hex);
  const ct = cipher.ciphertext.toString(CryptoJS.enc.Base64);
  const mac = CryptoJS.HmacSHA256(ivHex + ct, key).toString(CryptoJS.enc.Hex);
  return { iv: ivHex, ct: ct, mac: mac };
}

/** 解密 + MAC 校验，失败返回 null */
function decrypt(payload, key) {
  if (!payload || !payload.iv || !payload.ct || !payload.mac) return null;
  const expect = CryptoJS.HmacSHA256(payload.iv + payload.ct, key).toString(CryptoJS.enc.Hex);
  if (expect !== payload.mac) return null; // MAC 不匹配
  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: CryptoJS.enc.Base64.parse(payload.ct) },
    key,
    { iv: CryptoJS.enc.Hex.parse(payload.iv), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
  );
  return decrypted.toString(CryptoJS.enc.Utf8);
}

/**
 * 首次设置口令：生成盐 + 随机 DEK，用口令派生 KEK 包裹 DEK。
 * 返回 header（salt + wrappedDek），需随密文一起保存。
 */
function createVault(password) {
  const salt = randomHex(16);
  const kek = deriveKey(password, salt, ITERATIONS);
  const dek = CryptoJS.lib.WordArray.random(32); // 256 位 DEK
  const wrappedDek = encrypt(dek.toString(CryptoJS.enc.Hex), kek);
  return { salt: salt, iter: ITERATIONS, wrappedDek: wrappedDek };
}

/**
 * 解锁：口令 + header → KEK → 解 wrappedDek → DEK。
 * 口令错误时 MAC 校验失败，返回 null。
 */
function unlock(password, header) {
  if (!header || !header.salt || !header.wrappedDek) return null;
  const kek = deriveKey(password, header.salt, header.iter || ITERATIONS);
  const dekHex = decrypt(header.wrappedDek, kek);
  if (!dekHex) return null;
  return CryptoJS.enc.Hex.parse(dekHex);
}

/** 用 DEK 加密保险库对象，返回密文结构 */
function encryptVault(dek, obj) {
  return encrypt(JSON.stringify(obj), dek);
}

/** 用 DEK 解密保险库对象，失败返回 null */
function decryptVault(dek, payload) {
  const plain = decrypt(payload, dek);
  if (plain === null || plain === '') return null;
  try { return JSON.parse(plain); } catch (e) { return null; }
}

/** 组装云端存储的完整密文（服务端就存这一坨） */
function packVault(header, body) {
  return JSON.stringify({
    v: VAULT_VERSION,
    salt: header.salt,
    iter: header.iter,
    wrappedDek: header.wrappedDek,
    body: body
  });
}

/** 解析云端密文 */
function unpackVault(packed) {
  try {
    return JSON.parse(packed);
  } catch (e) {
    return null;
  }
}

module.exports = {
  ITERATIONS: ITERATIONS,
  VAULT_VERSION: VAULT_VERSION,
  randomHex: randomHex,
  deriveKey: deriveKey,
  encrypt: encrypt,
  decrypt: decrypt,
  createVault: createVault,
  unlock: unlock,
  encryptVault: encryptVault,
  decryptVault: decryptVault,
  packVault: packVault,
  unpackVault: unpackVault
};
