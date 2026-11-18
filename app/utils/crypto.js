'use strict';
/**
 * crypto.js —— 端到端加密保险库
 * 口令 → PBKDF2 → KEK → 包裹随机 DEK → AES-256-CBC + HMAC 加密内容
 * 服务端只收到密文，无法解密。口令不出设备。
 *
 * 随机数用 wx.getRandomValues（异步），避免依赖模拟器缺失的原生 crypto 模块。
 * 未构建 npm 时 available=false，云同步功能降级但页面不崩。
 */
let CryptoJS = null;
try {
  CryptoJS = require('crypto-js');
} catch (e) {
  CryptoJS = null;
}

const available = !!CryptoJS;

// PBKDF2 迭代次数（10 万次，兼顾安全与低端机速度）
const ITERATIONS = 100000;
// 保险库格式版本
const VAULT_VERSION = 1;

/** 安全随机字节（异步，优先 wx.getRandomValues，Node 兜底） */
function randomBytes(n) {
  return new Promise(function (resolve, reject) {
    // 小程序环境：wx.getRandomValues 异步
    if (typeof wx !== 'undefined' && wx.getRandomValues) {
      wx.getRandomValues({
        length: n,
        success: function (res) {
          resolve(new Uint8Array(res.randomValues));
        },
        fail: function (err) { reject(err); }
      });
      return;
    }
    // Node 环境（本地测试兜底）
    try {
      var wa = CryptoJS.lib.WordArray.random(n);
      var bytes = new Uint8Array(n);
      for (var i = 0; i < n; i++) {
        bytes[i] = (wa.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
      }
      resolve(bytes);
    } catch (e) { reject(e); }
  });
}

function bytesToHex(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += ('0' + bytes[i].toString(16)).slice(-2);
  return s;
}

/** 随机字节 → hex 字符串（异步） */
function randomHex(bytes) {
  return randomBytes(bytes).then(bytesToHex);
}

/** 口令 + 盐 → KEK（256 位，同步） */
function deriveKey(password, saltHex, iterations) {
  return CryptoJS.PBKDF2(password, CryptoJS.enc.Hex.parse(saltHex), {
    keySize: 256 / 32,
    iterations: iterations || ITERATIONS,
    hasher: CryptoJS.algo.SHA256
  });
}

/** AES-256-CBC 加密 + HMAC-SHA256（异步，随机 IV） */
function encrypt(plaintext, key) {
  return randomBytes(16).then(function (ivBytes) {
    var iv = CryptoJS.lib.WordArray.create(ivBytes, ivBytes.length);
    var cipher = CryptoJS.AES.encrypt(plaintext, key, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
    var ivHex = iv.toString(CryptoJS.enc.Hex);
    var ct = cipher.ciphertext.toString(CryptoJS.enc.Base64);
    var mac = CryptoJS.HmacSHA256(ivHex + ct, key).toString(CryptoJS.enc.Hex);
    return { iv: ivHex, ct: ct, mac: mac };
  });
}

/** hex 字符串 → 密钥 WordArray（免口令模式用） */
function hexKey(hex) {
  if (!CryptoJS || !hex) return null;
  return CryptoJS.enc.Hex.parse(hex);
}

/** 解密 + MAC 校验（同步），失败返回 null */
function decrypt(payload, key) {
  if (!payload || !payload.iv || !payload.ct || !payload.mac) return null;
  var expect = CryptoJS.HmacSHA256(payload.iv + payload.ct, key).toString(CryptoJS.enc.Hex);
  if (expect !== payload.mac) return null;
  var decrypted = CryptoJS.AES.decrypt(
    { ciphertext: CryptoJS.enc.Base64.parse(payload.ct) },
    key,
    { iv: CryptoJS.enc.Hex.parse(payload.iv), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
  );
  return decrypted.toString(CryptoJS.enc.Utf8);
}

/**
 * 首次设置口令：生成盐 + 随机 DEK，用口令派生 KEK 包裹 DEK（异步）。
 * 返回 header（salt + wrappedDek）。
 */
function createVault(password) {
  return Promise.all([randomHex(16), randomBytes(32)]).then(function (r) {
    var salt = r[0];
    var dekBytes = r[1];
    var dek = CryptoJS.lib.WordArray.create(dekBytes, dekBytes.length);
    var kek = deriveKey(password, salt, ITERATIONS);
    return encrypt(dek.toString(CryptoJS.enc.Hex), kek).then(function (wrappedDek) {
      return { salt: salt, iter: ITERATIONS, wrappedDek: wrappedDek };
    });
  });
}

/** 解锁：口令 + header → KEK → 解 wrappedDek → DEK（同步），口令错误返回 null */
function unlock(password, header) {
  if (!header || !header.salt || !header.wrappedDek) return null;
  var kek = deriveKey(password, header.salt, header.iter || ITERATIONS);
  var dekHex = decrypt(header.wrappedDek, kek);
  if (!dekHex) return null;
  return CryptoJS.enc.Hex.parse(dekHex);
}

/** 用 DEK 加密保险库对象（异步） */
function encryptVault(dek, obj) {
  return encrypt(JSON.stringify(obj), dek);
}

/** 用 DEK 解密保险库对象（同步），失败返回 null */
function decryptVault(dek, payload) {
  var plain = decrypt(payload, dek);
  if (plain === null || plain === '') return null;
  try { return JSON.parse(plain); } catch (e) { return null; }
}

/** 组装云端存储的完整密文（同步） */
function packVault(header, body) {
  return JSON.stringify({
    v: VAULT_VERSION,
    salt: header.salt,
    iter: header.iter,
    wrappedDek: header.wrappedDek,
    body: body
  });
}

/** 解析云端密文（同步） */
function unpackVault(packed) {
  try { return JSON.parse(packed); } catch (e) { return null; }
}

module.exports = {
  available: available,
  CryptoJS: CryptoJS,
  ITERATIONS: ITERATIONS,
  VAULT_VERSION: VAULT_VERSION,
  randomBytes: randomBytes,
  bytesToHex: bytesToHex,
  randomHex: randomHex,
  hexKey: hexKey,
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
