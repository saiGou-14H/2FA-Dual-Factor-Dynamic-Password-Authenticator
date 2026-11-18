/**
 * totp.js —— 纯 JS 的 HMAC-SHA1 / SHA256 + Base32 + HOTP/TOTP
 * 无任何依赖，微信小程序与 Node 均可运行（RFC 4226 / RFC 6238）
 */
'use strict';

var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/* ------------------------------------------------------------------ Base32 */

function base32Decode(input) {
  var s = String(input == null ? '' : input).replace(/[\s\-=]/g, '').toUpperCase();
  var bits = 0;
  var value = 0;
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var idx = B32.indexOf(s.charAt(i));
    if (idx < 0) continue;
    value = ((value << 5) | idx) & 0xFFFF;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xFF);
    }
  }
  return new Uint8Array(out);
}

function base32Encode(bytes) {
  var out = '';
  var bits = 0;
  var value = 0;
  for (var i = 0; i < bytes.length; i++) {
    value = ((value << 8) | bytes[i]) & 0xFFFF;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32.charAt((value >>> bits) & 0x1F);
    }
  }
  if (bits > 0) out += B32.charAt((value << (5 - bits)) & 0x1F);
  return out;
}

/* --------------------------------------------------------------- helpers */

function utf8Bytes(str) {
  var s = String(str);
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
    else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
      var c2 = s.charCodeAt(++i);
      var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
      out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
    } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
  }
  return new Uint8Array(out);
}

function concat(a, b) {
  var out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function rotl(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/* ------------------------------------------------------------------ SHA1 */

function sha1(bytes) {
  var len = bytes.length;
  var withPad = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  withPad.set(bytes);
  withPad[len] = 0x80;
  var view = new DataView(withPad.buffer);
  var bitLenHi = Math.floor(len * 8 / 0x100000000);
  var bitLenLo = (len * 8) >>> 0;
  view.setUint32(withPad.length - 8, bitLenHi, false);
  view.setUint32(withPad.length - 4, bitLenLo, false);

  var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  var w = new Uint32Array(80);

  for (var off = 0; off < withPad.length; off += 64) {
    for (var i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);

    var a = h0, b = h1, c = h2, d = h3, e = h4;
    for (i = 0; i < 80; i++) {
      var f, k;
      if (i < 20) { f = (b & c) | ((~b) & d); k = 0x5A827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      var t = (rotl(a, 5) + (f >>> 0) + e + k + w[i]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }

  var out = new Uint8Array(20);
  var ov = new DataView(out.buffer);
  ov.setUint32(0, h0, false); ov.setUint32(4, h1, false);
  ov.setUint32(8, h2, false); ov.setUint32(12, h3, false);
  ov.setUint32(16, h4, false);
  return out;
}

/* ---------------------------------------------------------------- SHA256 */

var K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr(x, n) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function sha256(bytes) {
  var len = bytes.length;
  var withPad = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  withPad.set(bytes);
  withPad[len] = 0x80;
  var view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 8, Math.floor(len * 8 / 0x100000000), false);
  view.setUint32(withPad.length - 4, (len * 8) >>> 0, false);

  var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
           0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var w = new Uint32Array(64);

  for (var off = 0; off < withPad.length; off += 64) {
    for (var i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (i = 16; i < 64; i++) {
      var s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      var s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (i = 0; i < 64; i++) {
      var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      var ch = ((e & f) ^ ((~e) & g)) >>> 0;
      var temp1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      var temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  var out = new Uint8Array(32);
  var ov = new DataView(out.buffer);
  for (i = 0; i < 8; i++) ov.setUint32(i * 4, h[i], false);
  return out;
}

/* ------------------------------------------------------------------- HMAC */

function hmac(hashFn, blockSize, keyBytes, msgBytes) {
  var key = keyBytes;
  if (key.length > blockSize) key = hashFn(key);
  var pad = new Uint8Array(blockSize);
  pad.set(key);

  var ipad = new Uint8Array(blockSize);
  var opad = new Uint8Array(blockSize);
  for (var i = 0; i < blockSize; i++) {
    ipad[i] = pad[i] ^ 0x36;
    opad[i] = pad[i] ^ 0x5C;
  }
  return hashFn(concat(opad, hashFn(concat(ipad, msgBytes))));
}

var ALGS = {
  SHA1: { hash: sha1, block: 64 },
  SHA256: { hash: sha256, block: 64 }
};

/* ------------------------------------------------------------ HOTP / TOTP */

function uint64Bytes(counter) {
  var out = new Uint8Array(8);
  var hi = Math.floor(counter / 0x100000000);
  var lo = counter >>> 0;
  var view = new DataView(out.buffer);
  view.setUint32(0, hi >>> 0, false);
  view.setUint32(4, lo, false);
  return out;
}

/** RFC 4226：HOTP */
function hotp(secretBytes, counter, digits, algorithm) {
  var alg = ALGS[String(algorithm || 'SHA1').toUpperCase()] || ALGS.SHA1;
  var mac = hmac(alg.hash, alg.block, secretBytes, uint64Bytes(counter));
  var offset = mac[mac.length - 1] & 0x0F;
  var code = ((mac[offset] & 0x7F) << 24) |
             ((mac[offset + 1] & 0xFF) << 16) |
             ((mac[offset + 2] & 0xFF) << 8) |
             (mac[offset + 3] & 0xFF);
  var d = parseInt(digits, 10);
  if (!isFinite(d) || d <= 0) d = 6;
  if (d > 10) d = 10;
  var mod = Math.pow(10, d);
  var str = String(code % mod);
  while (str.length < d) str = '0' + str;
  return str;
}

/** RFC 6238：TOTP 计数器 */
function totpCounter(period, epoch, nowMs) {
  var step = Number(period) > 0 ? Number(period) : 30;
  var ep = Number(epoch) > 0 ? Number(epoch) : 0;
  var now = typeof nowMs === 'number' ? nowMs : Date.now();
  return Math.floor((now - ep * 1000) / (step * 1000));
}

/** 生成 token 当前验证码 */
function generate(token, nowMs) {
  var secret = base32Decode(token.secret);
  if (!secret.length) return '';
  var type = String(token.type || 'totp').toLowerCase();
  if (type === 'hotp') {
    return hotp(secret, Number(token.counter) || 0, token.digits, token.algorithm);
  }
  var counter = totpCounter(token.period, token.epoch, nowMs);
  return hotp(secret, counter, token.digits, token.algorithm);
}

/** 距离下次刷新还剩多少秒 / 周期进度 0~1 */
function remaining(token, nowMs) {
  var period = Number(token.period) > 0 ? Number(token.period) : 30;
  var now = typeof nowMs === 'number' ? nowMs : Date.now();
  var elapsed = (now / 1000) % period;
  var left = period - elapsed;
  return { left: left, period: period, progress: elapsed / period };
}

/** 校验密钥格式（base32 字符集，允许空格/连字符） */
function isValidSecret(secret) {
  var s = String(secret || '').replace(/[\s\-]/g, '').toUpperCase();
  if (!s) return false;
  if (!/^[A-Z2-7]+$/.test(s)) return false;
  return s.length >= 8;
}

module.exports = {
  base32Decode: base32Decode,
  base32Encode: base32Encode,
  sha1: sha1,
  sha256: sha256,
  hmac: hmac,
  hotp: hotp,
  totpCounter: totpCounter,
  generate: generate,
  remaining: remaining,
  isValidSecret: isValidSecret,
  utf8Bytes: utf8Bytes
};
