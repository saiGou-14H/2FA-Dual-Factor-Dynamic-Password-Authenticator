'use strict';

var store = require('./utils/store.js');

App({
  globalData: {
    /** 全局「藏码」开关：true 时默认隐藏验证码 */
    hideCodes: true,
    /** 主题（预留） */
    theme: 'light',
    lastCreatedGroupId: '',
    windowInfo: null
  },

  onLaunch: function () {
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

    // 首次启动植入示例账号，方便预览 UI；删除后不再植入
    var seeded = wx.getStorageSync('otp_seeded');
    if (!seeded && store.count() === 0) {
      store.add({
        issuer: 'GitHub', label: 'alice@example.com',
        secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30, type: 'totp',
        groupId: store.WORK_GROUP_ID
      });
      store.add({
        issuer: 'Google', label: 'bob@gmail.com',
        secret: 'KRSXG5CTMVRXEZLU', algorithm: 'SHA1', digits: 6, period: 30, type: 'totp',
        groupId: store.PERSONAL_GROUP_ID
      });
      store.add({
        issuer: 'AWS', label: 'ops@corp.com',
        secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', algorithm: 'SHA256', digits: 8, period: 30, type: 'totp',
        groupId: store.WORK_GROUP_ID
      });
      wx.setStorageSync('otp_seeded', 1);
    }
  },

  setHideCodes: function (v) {
    this.globalData.hideCodes = !!v;
    wx.setStorageSync('otp_hide_codes', this.globalData.hideCodes ? 1 : 0);
  }
});
