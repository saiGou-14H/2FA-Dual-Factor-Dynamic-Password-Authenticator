var store = require('../../utils/store.js');
var otpauth = require('../../utils/otpauth.js');
var util = require('../../utils/util.js');
var app = getApp();

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    menuRightSpace: 96,
    json: '',
    uris: [],
    count: 0,
    expanded: false
  },

  onLoad: function () {
    var tokens = store.list();
    var nav = util.navMetrics();
    var payload = {
      format: 'otp-vault',
      version: 1,
      exportedAt: new Date().toISOString(),
      note: '明文备份，请妥善保管；任何拿到此内容的人都能生成你的验证码。',
      tokens: tokens
    };
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      menuRightSpace: nav.menuRightSpace,
      count: tokens.length,
      json: JSON.stringify(payload, null, 2),
      uris: tokens.map(function (t) {
        return {
          id: t.id,
          name: (t.issuer ? t.issuer + ' · ' : '') + t.label,
          uri: otpauth.build(t)
        };
      })
    });
  },

  onBack: function () {
    wx.navigateBack();
  },

  toggleExpand: function () {
    this.setData({ expanded: !this.data.expanded });
  },

  copyJson: function () {
    wx.setClipboardData({
      data: this.data.json,
      success: function () { util.toast('备份 JSON 已复制', 'success'); }
    });
  },

  copyUri: function (e) {
    var uri = e.currentTarget.dataset.uri;
    wx.setClipboardData({
      data: uri,
      success: function () { util.toast('链接已复制', 'success'); }
    });
  }
});
