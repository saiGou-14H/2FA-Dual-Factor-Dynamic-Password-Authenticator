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
      raw: (r && r.data) || '',
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

  syncing = true;

  /**
   * 覆盖保护（无条件，且在生成新密钥之前）：
   * 1) 云端有数据 + 本机 0 个账号 → 拒绝，避免清空云端
   * 2) 云端有数据 + 本机无密钥 → 拒绝，提示用恢复码/口令
   * 3) 云端有数据 + 密钥解不开 → 拒绝，说明不是同一份数据
   * 只有云端为空，或云端数据能用本机密钥解开，才允许上传。
   */
  return probe().then(function (info) {
    if (!info.hasData) return null;
    if (store.count() === 0) {
      throw {
        errMsg: '本机没有账号，上传会清空云端数据，已阻止。请先恢复数据。',
        code: 'EMPTY_LOCAL'
      };
    }
    var dek = vault.getDekHex();
    if (!dek) {
      throw {
        errMsg: '云端已有数据，但本机没有密钥。请用「恢复码」或「云端密钥备份」找回后再同步。',
        code: 'NO_DEK'
      };
    }
    if (!vault.canDecrypt(info.raw, dek)) {
      throw {
        errMsg: '云端数据与本机密钥不匹配，已阻止覆盖。请用恢复码或口令恢复。',
        code: 'DEK_MISMATCH'
      };
    }
    return null;
  }).then(function () {
    return vault.ensureDek();
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
 * 启动时自动恢复：本机没有账号但云端有数据 → 尝试用本机密钥解密并写回。
 * 返回 { restored:n } / { needKey:true } / { mismatch:true } / { empty:true } / { skipped:true }
 */
function autoRestore() {
  if (store.count() > 0) return Promise.resolve({ skipped: true });
  return probe().then(function (info) {
    if (!info.hasData) return { empty: true };
    var dek = vault.getDekHex();
    if (!dek) return { needKey: true };
    if (!vault.canDecrypt(info.raw, dek)) return { mismatch: true };
    var n = vault.applyPacked(info.raw, dek);
    markSynced(Date.now());
    return { restored: n };
  }).catch(function (e) {
    return { error: e };
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
  autoRestore: autoRestore,
  probe: probe
};
