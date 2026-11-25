'use strict';

var store = require('./utils/store.js');
var sync = require('./utils/sync.js');

App({
  globalData: {
    vaultDirty: false,
    /** 全局「藏码」开关：true 时默认隐藏验证码 */
    hideCodes: true,
    /** 主题（预留） */
    theme: 'light',
    lastCreatedGroupId: '',
    windowInfo: null
  },

  onLaunch: function () {
    // 云开发初始化（云同步用，必须在 wx.cloud.callContainer 之前调用）
    // traceUser: true 让云托管网关注入 openid，后端鉴权据此识别用户
    try {
      if (wx.cloud) {
        wx.cloud.init({ env: 'prod-d6gfcpp9vba4f1ae4', traceUser: true });
      }
    } catch (e) { /* ignore */ }

    try {
      var win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.globalData.windowInfo = win;
    } catch (e) { /* ignore */ }

    // 胶囊按钮位置（custom navigation 必须据此让位）
    try {
      if (wx.getMenuButtonBoundingClientRect) {
        this.globalData.menuButton = wx.getMenuButtonBoundingClientRect();
      }
    } catch (e) { /* ignore */ }

    var hide = wx.getStorageSync('otp_hide_codes');
    this.globalData.hideCodes = hide === '' || hide === undefined ? true : !!hide;
    store.ensureDefaults();

    // 启动时尝试从云端恢复（本机为空但云端有数据时）
    var self = this;
    if (wx.cloud) {
      sync.autoRestore().then(function (r) {
        if (!r) return;
        if (r.restored) {
          self.globalData.vaultDirty = true;
          self.globalData.restoredCount = r.restored;
        } else if (r.needKey) {
          self.globalData.restoreBlocked = 'needKey';
        } else if (r.mismatch) {
          self.globalData.restoreBlocked = 'mismatch';
        }
      }).catch(function () { /* 离线忽略 */ });
    }
  },

  setHideCodes: function (v) {
    this.globalData.hideCodes = !!v;
    wx.setStorageSync('otp_hide_codes', this.globalData.hideCodes ? 1 : 0);
  },

  /**
   * 退出小程序（切后台/关闭）时自动同步。
   * 静默执行：成功不打扰，失败也不弹窗（下次进入或手动同步会补）。
   */
  onHide: function () {
    if (!wx.cloud) return;
    try {
      sync.push().catch(function (err) {
        console.warn('[auto-sync] 失败', err && err.errMsg ? err.errMsg : err);
      });
    } catch (e) { /* ignore */ }
  }
});
