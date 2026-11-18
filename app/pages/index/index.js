var totp = require('../../utils/totp.js');
var store = require('../../utils/store.js');
var util = require('../../utils/util.js');
var otpauth = require('../../utils/otpauth.js');

var app = getApp();

function range(k) {
  var a = [];
  for (var i = 0; i < k; i++) a.push(i);
  return a;
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    menuRightSpace: 96,
    query: '',
    list: [],
    total: 0,
    visibleTotal: 0,
    groups: [],
    selectedGroupId: 'all',
    allActive: true,
    showMoveSheet: false,
    moveGroups: [],
    movingTokenId: '',
    showFabMenu: false,
    timeText: '',
    hideAll: true
  },

  onLoad: function () {
    var nav = util.navMetrics();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      menuRightSpace: nav.menuRightSpace,
      hideAll: app.globalData.hideCodes
    });
    this._revealed = {};
    this._hotpCode = {};
    this._lastCounter = {};
    this._pulseUntil = {};
    this._copiedUntil = {};
  },

  onShow: function () {
    this.reload();
    this.startTick();
  },

  onHide: function () { this.stopTick(); },
  onUnload: function () { this.stopTick(); },

  /* ---------------- 数据 ---------------- */

  reload: function () {
    this._tokens = store.list();
    var groups = store.groups();
    var selected = this.data.selectedGroupId;
    if (selected !== 'all' && !groups.some(function (group) { return group.id === selected; })) {
      selected = 'all';
    }
    this.setData({ groups: groups, selectedGroupId: selected, allActive: selected === 'all' });
    this._revealed = {};
    this.compute();
  },

  startTick: function () {
    this.stopTick();
    var self = this;
    this._timer = setInterval(function () { self.compute(); }, 1000);
  },

  stopTick: function () {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  compute: function () {
    var now = Date.now();
    var hideAll = app.globalData.hideCodes;
    var q = String(this.data.query || '').trim().toLowerCase();
    var tokens = this._tokens || [];
    var selectedGroupId = this.data.selectedGroupId;
    var list = [];

    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (selectedGroupId !== 'all' && t.groupId !== selectedGroupId) continue;
      var hay = (t.issuer + ' ' + t.label).toLowerCase();
      if (q && hay.indexOf(q) < 0) continue;

      var isHotp = t.type === 'hotp';
      var revealed;
      var code;

      if (isHotp) {
        code = (this._hotpCode || {})[t.id] || '';
        revealed = !!code;
      } else {
        var custom = this._revealed[t.id];
        revealed = typeof custom === 'boolean' ? custom : !hideAll;
        code = totp.generate(t, now);

        // 周期切换时给一次翻牌动画
        var counter = totp.totpCounter(t.period, t.epoch, now);
        if (this._lastCounter[t.id] !== undefined && this._lastCounter[t.id] !== counter) {
          this._pulseUntil[t.id] = now + 470;
        }
        this._lastCounter[t.id] = counter;
      }

      var r = totp.remaining(t, now);
      var period = r.period || 30;
      var left = Math.max(0, Math.ceil(r.left));
      var raw = String(code || '');
      var half = Math.ceil(raw.length / 2);

      list.push({
        id: t.id,
        issuer: t.issuer,
        label: t.label,
        groupId: t.groupId,
        groupName: this.groupName(t.groupId),
        type: t.type,
        algorithm: t.algorithm,
        digits: t.digits,
        period: period,
        counter: t.counter || 0,
        code: code,
        seg1: raw.slice(0, half),
        seg2: raw.slice(half),
        cells: range(Math.ceil((t.digits || 6) / 2)),
        revealed: revealed,
        leftText: left,
        progressPct: Math.round((r.left / period) * 100),
        ringColor: left <= 5 ? '#dc2626' : '#2563eb',
        trackColor: '#eceef1',
        pulse: revealed && now < (this._pulseUntil[t.id] || 0),
        copied: now < (this._copiedUntil[t.id] || 0),
        delay: Math.min(i * 40, 280)
      });
    }

    this.setData({
      list: list,
      total: tokens.length,
      visibleTotal: list.length,
      timeText: util.hhmmss(now),
      hideAll: hideAll
    });
  },

  groupName: function (id) {
    var groups = this.data.groups || [];
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].id === id) return groups[i].name;
    }
    return '个人';
  },

  onSelectGroup: function (e) {
    var groupId = e.currentTarget.dataset.id;
    this.setData({
      selectedGroupId: groupId,
      allActive: groupId === 'all'
    }, this.compute.bind(this));
  },

  gotoGroups: function () {
    wx.navigateTo({ url: '/pages/groups/groups' });
  },

  /* ---------------- 交互 ---------------- */

  onSearch: function (e) {
    this.setData({ query: e.detail.value }, this.compute.bind(this));
  },

  clearSearch: function () {
    this.setData({ query: '' }, this.compute.bind(this));
  },

  onToggle: function (e) {
    var id = e.detail.id;
    var t = null;
    for (var i = 0; i < (this._tokens || []).length; i++) {
      if (this._tokens[i].id === id) { t = this._tokens[i]; break; }
    }
    if (!t) return;

    if (t.type === 'hotp') {
      var nextCounter = (Number(t.counter) || 0) + 1;
      store.update(id, { counter: nextCounter });
      this._tokens = store.list();
      this._hotpCode = this._hotpCode || {};
      this._hotpCode[id] = totp.generate({ secret: t.secret, algorithm: t.algorithm,
        digits: t.digits, type: 'hotp', counter: nextCounter }, Date.now());
      this._pulseUntil[id] = Date.now() + 470;
    } else {
      var custom = this._revealed[id];
      var base = typeof custom === 'boolean' ? custom : !app.globalData.hideCodes;
      this._revealed[id] = !base;
    }
    this.compute();
  },

  onCopy: function (e) {
    var self = this;
    var id = e.detail.id;
    var target = null;
    for (var i = 0; i < this.data.list.length; i++) {
      if (this.data.list[i].id === id) { target = this.data.list[i]; break; }
    }
    if (!target || !target.code) {
      util.toast('该账号还没有验证码');
      return;
    }
    wx.setClipboardData({
      data: target.code,
      success: function () {
        self._copiedUntil[id] = Date.now() + 1300;
        self.compute();
        wx.vibrateShort && wx.vibrateShort({ type: 'light', fail: function () {} });
      }
    });
  },

  onMore: function (e) {
    var self = this;
    var id = e.detail.id;
    var t = null;
    for (var i = 0; i < (this._tokens || []).length; i++) {
      if (this._tokens[i].id === id) { t = this._tokens[i]; break; }
    }
    if (!t) return;

    wx.showActionSheet({
      itemList: ['复制 otpauth 链接', '编辑', '移动到分组', '删除'],
      success: function (res) {
        if (res.tapIndex === 0) {
          wx.setClipboardData({ data: otpauth.build(t) });
        } else if (res.tapIndex === 1) {
          wx.navigateTo({ url: '/pages/input/input?id=' + id });
        } else if (res.tapIndex === 2) {
          self.chooseGroup(id);
        } else if (res.tapIndex === 3) {
          self.confirmDelete(id, t);
        }
      }
    });
  },

  chooseGroup: function (id) {
    var token = (this._tokens || []).find(function (item) { return item.id === id; });
    var groups = store.groups().filter(function (group) { return token && group.id !== token.groupId; });
    if (!groups.length) {
      util.toast('没有其他可移动的分组');
      return;
    }
    this.setData({ showMoveSheet: true, moveGroups: groups, movingTokenId: id });
  },

  closeMoveSheet: function () {
    this.setData({ showMoveSheet: false, moveGroups: [], movingTokenId: '' });
  },

  confirmMoveGroup: function (e) {
    var id = this.data.movingTokenId;
    var groupId = e.currentTarget.dataset.id;
    var group = this.data.moveGroups.find(function (item) { return item.id === groupId; });
    if (!id || !group) return;
    store.update(id, { groupId: group.id });
    this.closeMoveSheet();
    this.reload();
    util.toast('已移动到「' + group.name + '」', 'success');
  },

  confirmDelete: function (id, t) {
    var self = this;
    wx.showModal({
      title: '删除账号',
      content: '删除「' + (t.issuer ? t.issuer + ' · ' : '') + t.label + '」后需重新添加密钥。',
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: function (res) {
        if (!res.confirm) return;
        store.remove(id);
        self.reload();
        util.toast('已删除');
      }
    });
  },

  toggleAll: function () {
    var next = !this.data.hideAll;
    app.setHideCodes(next);
    this._revealed = {};
    this.compute();
    util.toast(next ? '已全部隐藏' : '已全部显示');
  },

  gotoSettings: function () {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  gotoAdd: function () {
    var groupId = this.data.selectedGroupId === 'all'
      ? store.PERSONAL_GROUP_ID : this.data.selectedGroupId;
    wx.navigateTo({ url: '/pages/input/input?groupId=' + encodeURIComponent(groupId) });
  },

  /* ---------------- 悬浮按钮（FAB） ---------------- */

  toggleFab: function () {
    this.setData({ showFabMenu: !this.data.showFabMenu });
  },

  closeFab: function () {
    if (this.data.showFabMenu) this.setData({ showFabMenu: false });
  },

  // 扫描二维码 → 解析 → 跳 input 预填
  fabScan: function () {
    var self = this;
    this.setData({ showFabMenu: false });
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: function (res) {
        var token = otpauth.parse(res.result);
        if (!token) {
          util.toast('不是有效的 otpauth 二维码');
          return;
        }
        var groupId = self.data.selectedGroupId === 'all'
          ? store.PERSONAL_GROUP_ID : self.data.selectedGroupId;
        wx.navigateTo({
          url: '/pages/input/input?groupId=' + encodeURIComponent(groupId) +
               '&scan=' + encodeURIComponent(res.result)
        });
      },
      fail: function (err) {
        if (err && String(err.errMsg || '').indexOf('cancel') >= 0) return;
        util.toast('扫码失败，可手动输入');
      }
    });
  },

  // 手动输入密钥
  fabInput: function () {
    this.setData({ showFabMenu: false });
    this.gotoAdd();
  },

  // 设置
  fabSettings: function () {
    this.setData({ showFabMenu: false });
    this.gotoSettings();
  }
});
