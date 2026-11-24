var store = require('../../utils/store.js');
var util = require('../../utils/util.js');
var crypto = require('../../utils/crypto.js');
var vault = require('../../utils/vault.js');
var sync = require('../../utils/sync.js');
var cloudSync = require('../../utils/cloud-sync.js');

var app = getApp();

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    menuRightSpace: 96,
    hideCodes: true,
    count: 0,
    deletedCount: 0,
    nowText: '',
    dateText: '',
    version: '1.3.1',
    showAbout: false,
    lastSyncText: '尚未同步',
    syncing: false,
    loadingShow: false,
    loadingText: '处理中',
    ready: false,          // crypto 可用
    // 迁移二维码浮层
    showMigrate: false,
    qrImage: '',
    migrateTip: '',
    // 恢复码
    showRecovery: false,
    recoveryCode: '',
    recoveryInput: '',
    showPwSheet: false,
    pwInput: '',
    hasCloudKey: false,
    // 身份（只读，来自微信授权）
    nickname: '',
    avatar: '',
    authorized: false,
    showAuth: false
  },

  onShow: function () {
    var nav = util.navMetrics();
    var profile = store.getProfile();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      menuRightSpace: nav.menuRightSpace,
      hideCodes: app.globalData.hideCodes,
      count: store.count(),
      deletedCount: store.deletedCount(),
      nickname: profile.nickname || '',
      avatar: profile.avatar || '',
      authorized: !!profile.authorized,
      nowText: util.hhmmss(),
      dateText: util.ymd(),
      ready: crypto.available
    });
    this.refreshSyncText();
    this.syncProfileFromCloud();
  },

  /** 本机身份缺失时从云端补回 */
  syncProfileFromCloud: function () {
    var self = this;
    var p = store.getProfile();
    if (p && p.authorized && p.nickname) return;
    if (!wx.cloud || !crypto.available) return;
    cloudSync.loadProfile().then(function (r) {
      if (r && r.nickname) {
        store.setProfile({ nickname: r.nickname, avatar: r.avatar || '', authorized: true });
        self.setData({
          nickname: r.nickname,
          avatar: r.avatar || '',
          authorized: true
        });
      }
    }).catch(function () { /* ignore */ });
  },

  onBack: function () {
    wx.navigateBack();
  },

  /* ================= 同步状态 ================= */

  /** 显示加载遮罩（异步操作前调用，避免界面像卡死） */
  showLoading: function (text) {
    this.setData({ loadingShow: true, loadingText: text || '处理中' });
  },

  hideLoading: function () {
    if (this.data.loadingShow) this.setData({ loadingShow: false });
  },

  refreshSyncText: function () {
    var at = sync.lastSyncAt();
    this.setData({
      lastSyncText: at ? ('已同步 · ' + this.formatTime(at)) : '尚未同步'
    });
  },

  formatTime: function (ts) {
    var d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    var now = new Date();
    var sameDay = d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
    return sameDay ? hm : ((d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm);
  },

  /* ================= 手动同步 ================= */

  manualSync: function () {
    var self = this;
    if (!crypto.available) {
      util.toast('请先在开发者工具「构建 npm」');
      return;
    }
    if (this.data.syncing) return;
    this.setData({ syncing: true });
    this.showLoading('正在同步');
    sync.push().then(function (r) {
      self.setData({ syncing: false });
      self.hideLoading();
      self.refreshSyncText();
      util.toast(r && r.skipped ? '没有需要同步的数据' : '已同步到云端', 'success');
    }).catch(function (err) {
      self.setData({ syncing: false });
      self.hideLoading();
      util.toast('同步失败：' + (err && err.errMsg ? err.errMsg : '网络错误'));
    });
  },

  /* ================= 迁移：生成二维码 ================= */

  openMigrate: function () {
    var self = this;
    if (!crypto.available) {
      util.toast('请先在开发者工具「构建 npm」');
      return;
    }
    if (store.count() === 0) {
      util.toast('还没有账号可迁移');
      return;
    }
    this.showLoading('正在生成二维码');
    vault.ensureDek().then(function (dek) {
      // 迁移前先把最新数据推上云，确保新账号领到的是当前内容
      return sync.push().then(function () { return dek; });
    }).then(function (dek) {
      return cloudSync.issueMigrate(dek);
    }).then(function (r) {
      self.hideLoading();
      if (!r || !r.qr) {
        util.toast('生成失败');
        return;
      }
      self.setData({
        showMigrate: true,
        qrImage: r.qr,
        migrateTip: '用新微信号打开本小程序，在「设置 → 从二维码迁移」扫描此码。' +
                    '有效期 5 分钟，仅可使用一次。'
      });
    }).catch(function (err) {
      self.hideLoading();
      util.toast('生成失败：' + (err && err.errMsg ? err.errMsg : '网络错误'));
    });
  },

  closeMigrate: function () {
    this.setData({ showMigrate: false, qrImage: '', migrateTip: '' });
  },

  /* ================= 迁移：扫码领取 ================= */

  scanMigrate: function () {
    var self = this;
    if (!crypto.available) {
      util.toast('请先在开发者工具「构建 npm」');
      return;
    }
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: function (res) {
        self.doClaim(res.result);
      },
      fail: function (err) {
        if (err && String(err.errMsg || '').indexOf('cancel') >= 0) return;
        util.toast('扫码失败');
      }
    });
  },

  doClaim: function (text) {
    var self = this;
    var parsed = this.parseMigratePayload(text);
    if (!parsed) {
      util.toast('这不是有效的迁移二维码');
      return;
    }
    wx.showModal({
      title: '接收迁移',
      content: '将把原账号的全部密钥迁移到当前微信号，覆盖本机现有数据。继续？',
      confirmText: '接收',
      success: function (res) {
        if (!res.confirm) return;
        self.showLoading('正在接收');
        cloudSync.claimMigrate(parsed.token).then(function () {
          // 用二维码里的 DEK 解密云端密文
          vault.setDekHex(parsed.dek);
          return sync.pull(parsed.dek);
        }).then(function (r) {
          self.hideLoading();
          self.refreshSyncText();
          self.setData({ count: store.count() });
          util.toast('已迁移 ' + (r.count || 0) + ' 个账号', 'success');
        }).catch(function (err) {
          self.hideLoading();
          util.toast('迁移失败：' + (err && err.errMsg ? err.errMsg : '未知错误'));
        });
      }
    });
  },

  /** 解析 otpmig://migrate?t=<token>&k=<dekHex> */
  parseMigratePayload: function (text) {
    var s = String(text || '').trim();
    if (s.indexOf('otpmig://migrate') !== 0) return null;
    var q = s.indexOf('?');
    if (q < 0) return null;
    var out = {};
    s.slice(q + 1).split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i < 0) return;
      out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
    });
    if (!/^[0-9a-f]{32}$/.test(out.t || '')) return null;
    if (!/^[0-9a-fA-F]{16,128}$/.test(out.k || '')) return null;
    return { token: out.t, dek: out.k };
  },

  /* ================= 恢复码 ================= */

  openRecovery: function () {
    var self = this;
    var code = vault.getRecoveryCode();
    this.setData({
      showRecovery: true,
      recoveryCode: code ? vault.formatRecoveryCode(code) : '',
      recoveryInput: ''
    });
    if (!crypto.available) return;
    sync.probe().then(function (info) {
      self.setData({ hasCloudKey: !!info.hasHeader });
    }).catch(function () { /* 网络问题忽略 */ });
  },

  /* ================= 云端密钥备份（口令包裹） ================= */

  openPwSheet: function () {
    this.setData({ showPwSheet: true, pwInput: '' });
  },

  closePwSheet: function () {
    this.setData({ showPwSheet: false, pwInput: '' });
  },

  onPwInput: function (e) {
    this.setData({ pwInput: e.detail.value });
  },

  /** 用当前口令包裹 DEK 并上传 */
  uploadKeyBackup: function () {
    var self = this;
    var pw = String(this.data.pwInput || '');
    if (pw.length < 8) {
      util.toast('口令至少 8 位');
      return;
    }
    if (!vault.hasDek()) {
      util.toast('请先同步一次，生成本机密钥');
      return;
    }
    this.showLoading('正在加密密钥并上传');
    vault.wrapDekWithPassword(pw).then(function () {
      return sync.push();
    }).then(function () {
      self.hideLoading();
      self.setData({ showPwSheet: false, pwInput: '', hasCloudKey: true });
      util.toast('密钥已加密上传', 'success');
    }).catch(function (err) {
      self.hideLoading();
      util.toast('上传失败：' + (err && err.errMsg ? err.errMsg : '网络错误'));
    });
  },

  /** 用口令从云端解开并恢复 */
  restoreByPassword: function () {
    var self = this;
    var pw = String(this.data.pwInput || '');
    if (!pw) {
      util.toast('请输入恢复口令');
      return;
    }
    this.showLoading('正在校验口令');
    sync.probe().then(function (info) {
      if (!info.hasHeader) {
        throw { errMsg: '云端没有密钥备份，请先在本机设置恢复口令' };
      }
      var dekHex = vault.unwrapDekWithPassword(pw, info.header);
      if (!dekHex) {
        throw { errMsg: '口令不对' };
      }
      return sync.pull(dekHex);
    }).then(function (res) {
      self.hideLoading();
      self.setData({
        showPwSheet: false,
        pwInput: '',
        count: store.count(),
        deletedCount: store.deletedCount()
      });
      self.refreshSyncText();
      util.toast('已恢复 ' + (res.count || 0) + ' 个账号', 'success');
    }).catch(function (err) {
      self.hideLoading();
      util.toast(err && err.errMsg ? err.errMsg : '恢复失败');
    });
  },

  closeRecovery: function () {
    this.setData({ showRecovery: false, recoveryInput: '' });
  },

  copyRecovery: function () {
    if (!this.data.recoveryCode) {
      util.toast('本机还没有密钥');
      return;
    }
    wx.setClipboardData({ data: this.data.recoveryCode });
  },

  onRecoveryInput: function (e) {
    this.setData({ recoveryInput: e.detail.value });
  },

  applyRecovery: function () {
    var self = this;
    var r = vault.importRecoveryCode(this.data.recoveryInput);
    if (r.error) {
      util.toast(r.error);
      return;
    }
    this.showLoading('正在用恢复码解锁');
    sync.pull().then(function (res) {
      self.hideLoading();
      self.setData({
        showRecovery: false,
        recoveryInput: '',
        count: store.count(),
        deletedCount: store.deletedCount()
      });
      self.refreshSyncText();
      util.toast('已恢复 ' + (res.count || 0) + ' 个账号', 'success');
    }).catch(function (err) {
      self.hideLoading();
      util.toast('恢复失败：' + (err && err.errMsg ? err.errMsg : '云端无数据'));
    });
  },

  /* ================= 身份授权 ================= */

  /** 未授权时点身份行，重新拉起授权引导 */
  openAuthIfNeeded: function () {
    if (this.data.authorized) return;
    this.setData({ showAuth: true });
  },

  onAuthDone: function () {
    var profile = store.getProfile();
    this.setData({
      showAuth: false,
      nickname: profile.nickname || '',
      avatar: profile.avatar || '',
      authorized: !!profile.authorized
    });
    util.toast('身份已保存', 'success');
    if (crypto.available && vault.hasDek()) {
      sync.push().catch(function () { /* 下次自动同步会补 */ });
    }
  },

  onAuthSkip: function () {
    this.setData({ showAuth: false });
  },

  /* ================= 其他设置 ================= */

  onToggleHide: function () {
    var v = !this.data.hideCodes;
    app.setHideCodes(v);
    this.setData({ hideCodes: v });
    util.toast(v ? '默认隐藏验证码' : '默认显示验证码');
  },

  gotoExport: function () {
    if (store.count() === 0) {
      util.toast('还没有可导出的账号');
      return;
    }
    wx.navigateTo({ url: '/pages/export/export' });
  },

  gotoRecycle: function () {
    wx.navigateTo({ url: '/pages/recycle/recycle' });
  },

  clearAll: function () {
    var self = this;
    var total = store.count();
    if (total === 0) {
      util.toast('已经没有账号了');
      return;
    }

    // 第一次确认
    wx.showModal({
      title: '清空全部账号',
      content: total + ' 个账号将移入回收站，之后可在「回收站」按删除时间找回。',
      confirmText: '移入',
      cancelText: '取消',
      confirmColor: '#dc2626',
      success: function (res) {
        if (!res.confirm) return;
        // 第二次确认（按钮文案上限 4 字，超过会导致弹窗静默失败）
        wx.showModal({
          title: '再确认一次',
          content: '确定清空全部 ' + total + ' 个账号？它们会进入回收站，不会立刻删除。',
          confirmText: '确认',
          cancelText: '取消',
          confirmColor: '#dc2626',
          success: function (res2) {
            if (!res2.confirm) return;
            self.doClearAll();
          },
          fail: function (err) {
            console.error('[clearAll] 第二次确认失败', err);
            util.toast('确认框打开失败');
          }
        });
      },
      fail: function (err) {
        console.error('[clearAll] 第一次确认失败', err);
        util.toast('确认框打开失败');
      }
    });
  },

  /** 真正执行清空（两次确认后调用） */
  doClearAll: function () {
    var self = this;
    this.showLoading('正在移入回收站');
    setTimeout(function () {
      var n = store.removeAll();
      self.hideLoading();
      self.setData({ count: store.count(), deletedCount: store.deletedCount() });
      util.toast('已移入回收站 ' + n + ' 个');
      // 标记数据有变动，首页返回时会重新读取
      app.globalData.vaultDirty = true;
    }, 60);
  },

  openAbout: function () {
    this.setData({ showAbout: true });
  },

  closeAbout: function () {
    this.setData({ showAbout: false });
  }
});
