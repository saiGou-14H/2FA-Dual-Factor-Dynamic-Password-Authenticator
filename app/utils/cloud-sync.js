'use strict';
/**
 * cloud-sync.js —— 云同步客户端
 * 通过 wx.cloud.callContainer 调用云托管后端，只传密文。
 * 身份 = 微信 openid（网关自动注入），无需登录、无需口令。
 */
var ENV = 'prod-d6gfcpp9vba4f1ae4';
var SERVICE = 'express-w3rv';

/** 配置后端（部署信息变化时调用） */
function configure(opts) {
  if (opts && opts.env) ENV = opts.env;
  if (opts && opts.service) SERVICE = opts.service;
}

function callContainer(path, method, data) {
  return new Promise(function (resolve, reject) {
    if (!wx.cloud || !wx.cloud.callContainer) {
      reject({ errMsg: 'callContainer 不可用：请确认已 wx.cloud.init' });
      return;
    }
    wx.cloud.callContainer({
      config: { env: ENV },
      path: path,
      header: {
        'X-WX-SERVICE': SERVICE,
        'content-type': 'application/json'
      },
      method: method,
      data: data || {},
      timeout: 60000,
      success: function (res) {
        var code = res.statusCode || 0;
        if (code >= 200 && code < 300) {
          resolve(res.data);
          return;
        }
        reject({
          errMsg: 'HTTP ' + code + (res.data && res.data.error ? ' / ' + res.data.error : ''),
          statusCode: code,
          body: res.data
        });
      },
      fail: function (err) {
        reject(err || { errMsg: '网络错误' });
      }
    });
  });
}

/** 上传密文 */
function upload(packed, rev) {
  return callContainer('/api/vault', 'POST', { data: packed, rev: rev || 0 });
}

/** 下载密文，返回 { data, rev, updated_at } 或 { data: null } */
function download() {
  return callContainer('/api/vault', 'GET');
}

/** 健康检查 */
function health() {
  return callContainer('/api/health', 'GET');
}

/** 云端版本列表（不含正文） */
function listVersions() {
  return callContainer('/api/vault/history', 'GET');
}

/** 取指定版本的密文 */
function getVersion(id) {
  return callContainer('/api/vault/history/' + id, 'GET');
}

/** 把指定版本设为当前 */
function restoreVersion(id) {
  return callContainer('/api/vault/restore', 'POST', { id: id });
}

/** 取服务端派生的 KEK（HKDF(openid + VAULT_SECRET)），用于零配置找回密钥 */
function getWrapKey() {
  return callContainer('/api/wrap-key', 'GET');
}

/** 生成迁移令牌 + 二维码（返回 { token, expiresAt, qr, payload }） */
function issueMigrate(dekHex) {
  return callContainer('/api/migrate/issue', 'POST', { dek: dekHex });
}

/** 新账号领取迁移数据 */
function claimMigrate(token) {
  return callContainer('/api/migrate/claim', 'POST', { token: token });
}

module.exports = {
  configure: configure,
  upload: upload,
  download: download,
  health: health,
  getWrapKey: getWrapKey,
  listVersions: listVersions,
  getVersion: getVersion,
  restoreVersion: restoreVersion,
  issueMigrate: issueMigrate,
  claimMigrate: claimMigrate,
  ENV: ENV,
  SERVICE: SERVICE
};
