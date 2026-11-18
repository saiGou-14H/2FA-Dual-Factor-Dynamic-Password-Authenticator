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
    version: '1.1.0',
    lastSyncText: '尚未同步',
    syncing: false,
    loadingShow: false,
    loadingText: '处理中',
    ready: false,          // crypto 可用
    // 迁移二维码浮层
    showMigrate: false,
    qrImage: '',
    migrateTip: ''
  },

  onShow: function () {
    var nav = util.navMetrics();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      menuRightSpace: nav.menuRightSpace,
      hideCodes: app.globalData.hideCodes,
      count: store.count(),
      deletedCount: store.deletedCount(),
      nowText: util.hhmmss(),
      dateText: util.ymd(),
      ready: crypto.available
    });
    this.refreshSyncText();
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

  /* ================= 其他设置 ================= */

  onToggleHide: function (e) {
    var v = !!e.detail.value;
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
    if (store.count() === 0) {
      util.toast('已经是空的了');
      return;
    }
    wx.showModal({
      title: '清空全部账号',
      content: '全部账号将移入回收站，可在「回收站」里按时间找回或彻底删除。',
      confirmText: '移入回收站',
      confirmColor: '#dc2626',
      success: function (res) {
        if (!res.confirm) return;
        self.showLoading('正在移入回收站');
        setTimeout(function () {
          var n = store.removeAll();
          self.hideLoading();
          self.setData({ count: store.count(), deletedCount: store.deletedCount() });
          util.toast('已移入回收站 ' + n + ' 个');
        }, 60);
      }
    });
  },

  onAbout: function () {
    wx.showModal({
      title: '关于',
      content: '本地优先的两步验证器。\n\n'
        + '· 密钥在本机加密后上传，服务端只见密文\n'
        + '· 身份用你的微信 openid，无需注册登录\n'
        + '· 退出小程序会自动同步，也可手动同步\n'
        + '· 换机用「迁移二维码」把密钥带到新微信',
      showCancel: false,
      confirmText: '知道了'
    });
  }
});
