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

/** 探测云端是否有密文（不解密，只看有没有） */
function probe() {
  return cloudSync.download().then(function (r) {
    var packed = null;
    if (r && r.data) {
      try { packed = JSON.parse(r.data); } catch (e) { packed = null; }
    }
    return {
      hasData: !!(r && r.data),
      hasHeader: !!(packed && packed.header && packed.header.wrappedDek),
      header: (packed && packed.header) || null,
      rev: (r && r.rev) || 0,
      updatedAt: (r && r.updated_at) || 0
    };
  });
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
  // 关键保护：本机原本没有密钥（说明是重装/删除小程序后重建），
  // 若云端已有密文，直接上传会把别人的旧数据永久覆盖掉 —— 必须先拒绝。
  var isNewDek = !vault.hasDek();
  syncing = true;
  return vault.ensureDek().then(function (dek) {
    if (!isNewDek) return dek;
    return probe().then(function (info) {
      if (info.hasData) {
        throw {
          errMsg: '云端已有加密数据，但本机没有对应密钥。请先用「恢复码」或「迁移二维码」找回，避免覆盖。',
          code: 'DEK_MISMATCH'
        };
      }
      return dek;
    });
  }).then(function (dek) {
    return vault.encryptCurrent(dek);
  }).then(function (packed) {
    // 若有口令包裹的 header，一并上传（header 本身是加密结果，可公开）
    var header = vault.getHeader();
    if (header) {
      try {
        var obj = JSON.parse(packed);
        obj.header = header;
        packed = JSON.stringify(obj);
      } catch (e) { /* 保持原样 */ }
    }
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
  pull: pull,
  probe: probe
};
