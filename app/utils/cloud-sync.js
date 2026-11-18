'use strict';
/**
 * cloud-sync.js —— 云同步客户端
 * 通过 wx.cloud.callContainer 调用云托管后端，只传密文。
 *
 * 后端信息（部署时填一次）：
 *   env     云开发环境 ID
 *   service 云托管服务名
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
    wx.cloud.callContainer({
      config: { env: ENV },
      path: path,
      header: {
        'X-WX-SERVICE': SERVICE,
        'content-type': 'application/json'
      },
      method: method,
      data: data || {},
      success: function (res) {
        resolve(res.data);
      },
      fail: function (err) {
        reject(err);
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

module.exports = {
  configure: configure,
  upload: upload,
  download: download,
  health: health,
  ENV: ENV,
  SERVICE: SERVICE
};
