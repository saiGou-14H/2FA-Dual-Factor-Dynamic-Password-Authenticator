var store = require('../../utils/store.js');
var util = require('../../utils/util.js');
var crypto = require('../../utils/crypto.js');
var cloudSync = require('../../utils/cloud-sync.js');

var app = getApp();
var HEADER_KEY = 'otp_vault_header';

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    menuRightSpace: 96,
    hideCodes: true,
    count: 0,
    nowText: '',
    dateText: '',
    version: '1.0.0',
    syncStatus: 'none',   // none=未设置口令 | locked=有口令未解锁 | ready=已解锁可同步
    syncing: false
  },

  onShow: function () {
    var nav = util.navMetrics();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      menuRightSpace: nav.menuRightSpace,
      hideCodes: app.globalData.hideCodes,
      count: store.count(),
      nowText: util.hhmmss(),
      dateText: util.ymd()
    });
    this.refreshSyncStatus();
  },

  onBack: function () {
    wx.navigateBack();
  },

  /* ================= 云同步 ================= */

  refreshSyncStatus: function () {
    var header = wx.getStorageSync(HEADER_KEY);
    var dek = app.globalData.dek;
    var status = header ? (dek ? 'ready' : 'locked') : 'none';
    this.setData({ syncStatus: status });
  },

  // 首次：设置口令，创建加密保险库并上传
  setupSync: function () {
    var self = this;
    wx.showModal({
      title: '设置云同步口令',
      editable: true,
      placeholderText: '输入口令（至少 8 位）',
      confirmText: '设置并同步',
      success: function (res) {
        if (!res.confirm) return;
        var password = (res.content || '').trim();
        if (password.length < 8) {
          util.toast('口令至少 8 位');
          return;
        }
        var header = crypto.createVault(password);
        var dek = crypto.unlock(password, header);
        wx.setStorageSync(HEADER_KEY, header);
        app.globalData.dek = dek;
        self.refreshSyncStatus();
        self.syncNow();
      }
    });
  },

  // 上传本地数据（需已解锁）
  syncNow: function () {
    var self = this;
    var dek = app.globalData.dek;
    var header = wx.getStorageSync(HEADER_KEY);
    if (!header || !dek) {
      util.toast('请先设置或输入口令');
      return;
    }
    this.setData({ syncing: true });
    var body = crypto.encryptVault(dek, { tokens: store.list(), groups: store.groups() });
    var packed = crypto.packVault(header, body);
    cloudSync.upload(packed).then(function () {
      self.setData({ syncing: false });
      util.toast('已同步到云端', 'success');
    }).catch(function (err) {
      self.setData({ syncing: false });
      util.toast('同步失败：' + (err && err.errMsg ? err.errMsg : '网络错误'));
    });
  },

  // 换机恢复：输入口令，下载云端密文并解密写回
  restoreSync: function () {
    var self = this;
    wx.showModal({
      title: '从云端恢复',
      editable: true,
      placeholderText: '输入云同步口令',
      confirmText: '恢复',
      success: function (res) {
        if (!res.confirm) return;
        var password = (res.content || '').trim();
        if (!password) return;
        self.setData({ syncing: true });
        cloudSync.download().then(function (r) {
          if (!r || !r.data) {
            self.setData({ syncing: false });
            util.toast('云端暂无数据');
            return;
          }
          var packed = crypto.unpackVault(r.data);
          if (!packed || !packed.salt || !packed.wrappedDek || !packed.body) {
            self.setData({ syncing: false });
            util.toast('云端数据格式异常');
            return;
          }
          var dek = crypto.unlock(password, packed);
          if (!dek) {
            self.setData({ syncing: false });
            util.toast('口令错误，无法解密');
            return;
          }
          var vault = crypto.decryptVault(dek, packed.body);
          if (!vault || !Array.isArray(vault.tokens)) {
            self.setData({ syncing: false });
            util.toast('数据解密失败');
            return;
          }
          store.replaceAll(vault.tokens, vault.groups || []);
          wx.setStorageSync(HEADER_KEY, { salt: packed.salt, iter: packed.iter, wrappedDek: packed.wrappedDek });
          app.globalData.dek = dek;
          self.setData({ syncing: false });
          self.refreshSyncStatus();
          util.toast('已恢复 ' + vault.tokens.length + ' 个账号', 'success');
        }).catch(function (err) {
          self.setData({ syncing: false });
          util.toast('恢复失败：' + (err && err.errMsg ? err.errMsg : '网络错误'));
        });
      }
    });
  },

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

  clearAll: function () {
    var self = this;
    if (store.count() === 0) {
      util.toast('已经是空的了');
      return;
    }
    wx.showModal({
      title: '清空全部账号',
      content: '将删除本机保存的所有密钥，且无法恢复。确认继续？',
      confirmText: '清空',
      confirmColor: '#dc2626',
      success: function (res) {
        if (!res.confirm) return;
        store.clear();
        wx.setStorageSync('otp_seeded', 1);
        self.setData({ count: 0 });
        util.toast('已清空');
        setTimeout(function () { wx.navigateBack(); }, 500);
      }
    });
  },

  onAbout: function () {
    wx.showModal({
      title: '关于',
      content: '本地 TOTP/HOTP 验证器 UI 原型。密钥仅保存在本机存储，不上传任何服务器。'
        + '\n\n当前为明文存储，接入加密保险库后即可作为正式版本使用。',
      showCancel: false,
      confirmText: '知道了'
    });
  }
});
