/**
 * otpauth.js —— otpauth:// URI 的解析与生成
 */
'use strict';

var totp = require('./totp.js');

var SUPPORTED_ALGS = ['SHA1', 'SHA256'];
var ALG_ALIAS = { SHA1: 'SHA1', SHA256: 'SHA256', SHA512: 'SHA512', MD5: 'MD5' };

function decode(s) {
  try {
    return decodeURIComponent(String(s || ''));
  } catch (e) {
    return String(s || '');
  }
}

function encode(s) {
  return encodeURIComponent(String(s == null ? '' : s));
}

/**
 * 解析 otpauth://totp/Issuer:account?secret=...&issuer=...&algorithm=SHA1&digits=6&period=30
 * @returns {object|null} 归一化后的 token；无法解析返回 null
 */
function parse(uri) {
  var raw = String(uri || '').trim();
  if (!/^otpauth:\/\//i.test(raw)) return null;

  var rest = raw.slice('otpauth://'.length);
  var qIndex = rest.indexOf('?');
  var pathPart = qIndex >= 0 ? rest.slice(0, qIndex) : rest;
  var queryPart = qIndex >= 0 ? rest.slice(qIndex + 1) : '';

  var slash = pathPart.indexOf('/');
  if (slash < 0) return null;
  var type = pathPart.slice(0, slash).toLowerCase();
  if (type !== 'totp' && type !== 'hotp') return null;

  var labelPath = decode(pathPart.slice(slash + 1));
  var query = {};
  queryPart.split('&').forEach(function (pair) {
    if (!pair) return;
    var eq = pair.indexOf('=');
    var k = eq >= 0 ? pair.slice(0, eq) : pair;
    var v = eq >= 0 ? pair.slice(eq + 1) : '';
    query[decode(k).toLowerCase()] = decode(v.replace(/\+/g, ' '));
  });

  var secret = String(query.secret || '').replace(/[\s\-]/g, '').toUpperCase();
  if (!secret) return null;

  // 标签拆分为 issuer / label
  var issuer = query.issuer || '';
  var label = labelPath;
  var colon = labelPath.indexOf(':');
  if (colon >= 0) {
    if (!issuer) issuer = labelPath.slice(0, colon).trim();
    label = labelPath.slice(colon + 1).trim();
  }
  if (!label) label = issuer || '未命名账号';

  var alg = String(query.algorithm || 'SHA1').toUpperCase();
  alg = ALG_ALIAS[alg] || 'SHA1';

  var digits = parseInt(query.digits, 10);
  if (!(digits === 6 || digits === 8)) digits = 6;

  var period = parseInt(query.period, 10);
  if (!(period > 0)) period = 30;

  var counter = parseInt(query.counter, 10);
  if (!(counter >= 0)) counter = 0;

  return {
    issuer: issuer,
    label: label,
    secret: secret,
    algorithm: alg,
    digits: digits,
    period: period,
    type: type,
    counter: counter,
    epoch: 0
  };
}

/**
 * 生成 otpauth:// URI
 */
function build(token) {
  var type = String(token.type || 'totp').toLowerCase() === 'hotp' ? 'hotp' : 'totp';
  var issuer = String(token.issuer || '');
  var label = String(token.label || '');
  var path = issuer ? encode(issuer) + ':' + encode(label) : encode(label);

  var parts = ['secret=' + encode(String(token.secret || '').toUpperCase())];
  if (issuer) parts.push('issuer=' + encode(issuer));
  if (token.algorithm) parts.push('algorithm=' + encode(String(token.algorithm).toUpperCase()));
  if (token.digits) parts.push('digits=' + encode(String(token.digits)));
  if (type === 'hotp') parts.push('counter=' + encode(String(token.counter || 0)));
  else parts.push('period=' + encode(String(token.period || 30)));

  return 'otpauth://' + type + '/' + path + '?' + parts.join('&');
}

/** 该算法是否被本地引擎支持 */
function isAlgorithmSupported(alg) {
  return SUPPORTED_ALGS.indexOf(String(alg || '').toUpperCase()) >= 0;
}

module.exports = {
  parse: parse,
  build: build,
  isAlgorithmSupported: isAlgorithmSupported,
  SUPPORTED_ALGS: SUPPORTED_ALGS
};
