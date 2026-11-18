'use strict';
/**
 * sync.js —— 同步编排（加密 → 上传 / 下载 → 解密）
 * 自动同步与手动同步共用这一份逻辑。
 */
var vault = require('./vault.js');
var cloudSync = require('./cloud-sync.js');
var store = require('./store.js');

var SYNC_TIME_KEY = 'otp_last_sync_at';
var syncing = false;

/** 上次同步时间戳（0 表示从未同步） */
function lastSyncAt() {
  try { return Number(wx.getStorageSync(SYNC_TIME_KEY)) || 0; } catch (e) { return 0; }
}

function markSynced(ts) {
  try { wx.setStorageSync(SYNC_TIME_KEY, ts || Date.now()); } catch (e) { /* ignore */ }
}

/** 是否正在同步 */
function isSyncing() {
  return syncing;
}

/**
 * 上传本地数据到云端（自动生成密钥，无需口令）
 * @returns Promise<{ok:true, at:number}>
 */
function push() {
  if (syncing) return Promise.reject({ errMsg: '正在同步中' });
  if (!vault.hasDek() && store.count() === 0) {
    return Promise.resolve({ ok: true, skipped: true, at: lastSyncAt() });
  }
  syncing = true;
  return vault.ensureDek().then(function (dek) {
    return vault.encryptCurrent(dek);
  }).then(function (packed) {
    return cloudSync.upload(packed, 0);
  }).then(function () {    var at = Date.now();
    markSynced(at);
    syncing = false;
    return { ok: true, at: at };
  }).catch(function (err) {
    syncing = false;
    throw err;
  });
}

/**
 * 从云端拉取并覆盖本地（用于迁移后 / 重新安装）
 * @returns Promise<{ok:true, count:number}>
 */
function pull(dekHex) {
  return new Promise(function (resolve, reject) {
    var key = dekHex || vault.getDekHex();
    if (!key) {
      reject({ errMsg: '本机还没有密钥，请先迁移' });
      return;
    }
    cloudSync.download().then(function (r) {
      if (!r || !r.data) {
        reject({ errMsg: '云端暂无数据' });
        return;
      }
      var count;
      try {
        count = vault.applyPacked(r.data, key);
      } catch (e) {
        reject({ errMsg: e.message || '解密失败' });
        return;
      }
      markSynced(Date.now());
      resolve({ ok: true, count: count });
    }).catch(reject);
  });
}

module.exports = {
  SYNC_TIME_KEY: SYNC_TIME_KEY,
  lastSyncAt: lastSyncAt,
  markSynced: markSynced,
  isSyncing: isSyncing,
  push: push,
  pull: pull
};
