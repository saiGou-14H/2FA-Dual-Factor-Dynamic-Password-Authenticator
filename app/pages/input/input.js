var totp = require('../../utils/totp.js');
var store = require('../../utils/store.js');
var otpauth = require('../../utils/otpauth.js');
var util = require('../../utils/util.js');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    menuRightSpace: 96,
    id: '',
    groups: [],
    groupNames: [],
    groupId: '',
    groupIndex: 0,
    issuer: '',
    label: '',
    secret: '',
    type: 'totp',
    types: ['基于时间（TOTP）', '基于计数（HOTP）'],
    typeIndex: 0,
    algorithms: ['SHA1', 'SHA256'],
    algorithm: 'SHA1',
    algorithmIndex: 0,
    digitsList: ['6 位', '8 位'],
    digits: 6,
    digitsIndex: 0,
    periods: ['30 秒', '60 秒'],
    period: 30,
    periodIndex: 0,
    counter: 0,
    errorMsg: '',
    showAdvanced: false,
    advancedSummary: '',
    secretVisible: false
  },

  onLoad: function (opts) {
    var nav = util.navMetrics();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      menuRightSpace: nav.menuRightSpace
    });
    this.reloadGroups(opts && opts.groupId);
    this.updateSummary();

    // 扫描二维码进入：解析并预填表单
    if (opts && opts.scan) {
      try {
        this.applyScanned(decodeURIComponent(opts.scan));
      } catch (e) { /* ignore */ }
      return;
    }

    if (!opts || !opts.id) return;
    var list = store.list();
    var t = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === opts.id) { t = list[i]; break; }
    }
    if (!t) return;

    var algIndex = this.data.algorithms.indexOf(t.algorithm);
    var digitsIndex = t.digits === 8 ? 1 : 0;
    var periodIndex = t.period === 60 ? 1 : 0;

    this.setData({
      id: t.id,
      groupId: t.groupId,
      issuer: t.issuer,
      label: t.label,
      secret: t.secret,
      type: t.type,
      typeIndex: t.type === 'hotp' ? 1 : 0,
      algorithm: t.algorithm,
      algorithmIndex: algIndex >= 0 ? algIndex : 0,
      digits: t.digits,
      digitsIndex: digitsIndex,
      period: t.period,
      periodIndex: periodIndex,
      counter: t.counter || 0
    });
    this.afterParamsLoaded();
    this.reloadGroups(t.groupId);
  },

  onShow: function () {
    var app = getApp();
    var createdGroupId = app.globalData.lastCreatedGroupId;
    if (createdGroupId) app.globalData.lastCreatedGroupId = '';
    this.reloadGroups(createdGroupId || this.data.groupId);
  },

  reloadGroups: function (preferredId) {
    var groups = store.groups();
    var groupId = preferredId || this.data.groupId || store.PERSONAL_GROUP_ID;
    var groupIndex = groups.findIndex(function (group) { return group.id === groupId; });
    if (groupIndex < 0) {
      groupIndex = groups.findIndex(function (group) { return group.id === store.PERSONAL_GROUP_ID; });
    }
    if (groupIndex < 0) groupIndex = 0;
    this.setData({
      groups: groups,
      groupNames: groups.map(function (group) { return group.name; }),
      groupId: groups[groupIndex] ? groups[groupIndex].id : '',
      groupIndex: groupIndex
    });
  },

  /* ---------------- 表单 ---------------- */

  onIssuer: function (e) { this.setData({ issuer: e.detail.value, errorMsg: '' }); },
  onLabel: function (e) { this.setData({ label: e.detail.value, errorMsg: '' }); },
  onSecret: function (e) { this.setData({ secret: e.detail.value, errorMsg: '' }); },
  onCounter: function (e) {
    var v = parseInt(e.detail.value, 10);
    this.setData({ counter: isFinite(v) && v >= 0 ? v : 0, errorMsg: '' });
    this.updateSummary();
  },

  /** 参数载入后：刷新摘要；存在非默认值时自动展开高级 */
  afterParamsLoaded: function () {
    var d = this.data;
    var nonDefault = d.type === 'hotp'
      || d.algorithm !== 'SHA1'
      || Number(d.digits) !== 6
      || Number(d.period) !== 30;
    this.setData({ showAdvanced: !!nonDefault });
    this.updateSummary();
  },

  /** 展开 / 收起高级设置 */
  toggleAdvanced: function () {
    this.setData({ showAdvanced: !this.data.showAdvanced });
  },

  /** 生成折叠态摘要，让用户不用展开也知道当前参数 */
  updateSummary: function () {
    var d = this.data;
    var parts = [];
    parts.push(d.type === 'hotp' ? 'HOTP' : 'TOTP');
    parts.push(d.algorithm);
    parts.push(d.digits + ' 位');
    if (d.type === 'hotp') {
      parts.push('计数器 ' + (Number(d.counter) || 0));
    } else {
      parts.push(d.period + ' 秒');
    }
    this.setData({ advancedSummary: parts.join(' · ') });
  },

  onType: function (e) {
    var idx = Number(e.detail.value);
    this.setData({ typeIndex: idx, type: idx === 1 ? 'hotp' : 'totp', errorMsg: '' });
    this.updateSummary();
  },

  onAlgorithm: function (e) {
    var idx = Number(e.detail.value);
    this.setData({ algorithmIndex: idx, algorithm: this.data.algorithms[idx], errorMsg: '' });
    this.updateSummary();
  },

  onDigits: function (e) {
    var idx = Number(e.detail.value);
    this.setData({ digitsIndex: idx, digits: idx === 1 ? 8 : 6, errorMsg: '' });
    this.updateSummary();
  },

  onPeriod: function (e) {
    var idx = Number(e.detail.value);
    this.setData({ periodIndex: idx, period: idx === 1 ? 60 : 30, errorMsg: '' });
    this.updateSummary();
  },

  onGroupChange: function (e) {
    var index = Number(e.detail.value);
    var group = this.data.groups[index];
    if (group) this.setData({ groupId: group.id, groupIndex: index });
  },

  onManageGroups: function () {
    getApp().globalData.lastCreatedGroupId = '';
    wx.navigateTo({ url: '/pages/groups/groups?from=input' });
  },

  toggleSecret: function () {
    this.setData({ secretVisible: !this.data.secretVisible });
  },

  /* ---------------- 扫码预填（FAB 扫描后进入时调用） ---------------- */

  applyScanned: function (text) {
    var token = otpauth.parse(text);
    if (!token) {
      util.toast('这不是有效的 otpauth 二维码');
      return;
    }
    var warn = '';
    if (!otpauth.isAlgorithmSupported(token.algorithm)) {
      warn = '该二维码使用 ' + token.algorithm + '，当前引擎仅支持 SHA1/SHA256，已回退 SHA1';
      token.algorithm = 'SHA1';
    }
    var algIndex = this.data.algorithms.indexOf(token.algorithm);
    this.setData({
      issuer: token.issuer,
      label: token.label,
      secret: token.secret,
      type: token.type,
      typeIndex: token.type === 'hotp' ? 1 : 0,
      algorithm: token.algorithm,
      algorithmIndex: algIndex >= 0 ? algIndex : 0,
      digits: token.digits,
      digitsIndex: token.digits === 8 ? 1 : 0,
      period: token.period,
      periodIndex: token.period === 60 ? 1 : 0,
      counter: token.counter || 0,
      errorMsg: warn
    });
    this.afterParamsLoaded();
    if (!warn) util.toast('已识别：' + (token.issuer || token.label), 'success');
  },

  /* ---------------- 保存 ---------------- */

  onSave: function () {
    var d = this.data;
    var secret = String(d.secret || '').replace(/[\s\-]/g, '').toUpperCase();

    if (!totp.isValidSecret(secret)) {
      this.setData({ errorMsg: '密钥格式不对：应为 Base32（A-Z 与 2-7，至少 8 位）' });
      return;
    }
    if (!String(d.label || '').trim()) {
      this.setData({ errorMsg: '请填写账号名称' });
      return;
    }

    var payload = {
      issuer: String(d.issuer || '').trim(),
      label: String(d.label || '').trim(),
      secret: secret,
      groupId: d.groupId,
      algorithm: d.algorithm,
      digits: d.digits,
      period: d.period,
      type: d.type,
      counter: d.type === 'hotp' ? Number(d.counter) || 0 : 0
    };

    if (d.id) {
      store.update(d.id, payload);
      util.toast('已保存', 'success');
    } else {
      store.add(payload);
      util.toast('已添加', 'success');
    }

    setTimeout(function () { wx.navigateBack(); }, 400);
  },

  onCancel: function () {
    wx.navigateBack();
  }
});
