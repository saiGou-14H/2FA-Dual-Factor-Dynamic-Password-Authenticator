var totp = require('../../utils/totp.js');
var store = require('../../utils/store.js');
var util = require('../../utils/util.js');
var otpauth = require('../../utils/otpauth.js');
var vault = require('../../utils/vault.js');
var sync = require('../../utils/sync.js');

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
    hideAll: true,
    // 分页
    pageSize: 20,
    page: 1,
    hasMore: false,
    loadingMore: false,
    refreshing: false,
    listSwitch: false,
    showAuth: false,
    // 身份
    nickname: '',
    avatar: '',
    authorized: false,
    syncText: '尚未同步'
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
    this.refreshIdentity();
    this.maybeAskAuth();
  },

  onHide: function () { this.stopTick(); },
  onUnload: function () { this.stopTick(); },

  /* ---------------- 身份 ---------------- */

  /** 刷新头像 / 昵称 / 同步状态 */
  refreshIdentity: function () {
    var profile = store.getProfile();
    var at = sync.lastSyncAt();
    this.setData({
      nickname: profile.nickname || '',
      avatar: profile.avatar || '',
      authorized: !!profile.authorized,
      syncText: at ? ('已同步 · ' + this.formatSync(at)) : '尚未同步，退出时自动上传'
    });
  },

  formatSync: function (ts) {
    var d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    var now = new Date();
    var sameDay = d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
    return sameDay ? hm : ((d.getMonth() + 1) + '月' + d.getDate() + '日');
  },

  /** 未授权时点身份行，拉起授权引导 */
  openAuthIfNeeded: function () {
    if (this.data.authorized) return;
    this.setData({ showAuth: true });
  },

  /* ---------------- 身份授权引导 ---------------- */

  /** 未授权时，每次启动提示一次 */
  maybeAskAuth: function () {
    if (app.globalData.authPrompted) return;
    var profile = store.getProfile();
    if (profile && profile.authorized) return;
    app.globalData.authPrompted = true;
    this.setData({ showAuth: true });
  },

  onAuthDone: function () {
    this.setData({ showAuth: false });
    this.refreshIdentity();
    util.toast('身份已保存', 'success');
    if (vault.hasDek()) {
      sync.push().catch(function () { /* 下次自动同步会补 */ });
    }
  },

  onAuthSkip: function () {
    this.setData({ showAuth: false });
  },

  /* ---------------- 下拉刷新 ---------------- */

  onPullDownRefresh: function () {
    if (this.data.refreshing) return;
    var self = this;
    this.setData({ refreshing: true, page: 1 });
    // 重新读本地数据（外部改动、回收站恢复等都能立刻反映）
    this._tokens = store.list();
    var groups = store.groups();
    var selected = this.data.selectedGroupId;
    if (selected !== 'all' && !groups.some(function (g) { return g.id === selected; })) {
      selected = 'all';
    }
    this.setData({ groups: groups, selectedGroupId: selected, allActive: selected === 'all' });
    this._revealed = {};
    this.compute();
    setTimeout(function () {
      self.setData({ refreshing: false });
      wx.stopPullDownRefresh();
    }, 420);
  },

  /* ---------------- 上拉加载更多 ---------------- */

  onReachBottom: function () {
    var self = this;
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    // 稍作延迟，让「加载中」指示有可见时长，避免闪烁
    setTimeout(function () {
      self.setData({ page: self.data.page + 1 }, function () {
        self.applySlice();
      });
    }, 280);
  },

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

      // 下一码：仅在已显示时有意义（HOTP 也给出计数器 +1 的码）
      var nextRaw = revealed ? String(totp.generateNext(t, now) || '') : '';
      var nextHalf = Math.ceil(nextRaw.length / 2);

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
        nextSeg1: nextRaw.slice(0, nextHalf),
        nextSeg2: nextRaw.slice(nextHalf),
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

    this._filtered = list;
    this.setData({
      total: tokens.length,
      visibleTotal: list.length,
      timeText: util.hhmmss(now),
      hideAll: hideAll
    });
    this.applySlice();
  },

  /** 列表切换时播一次轻落动画 */
  triggerListSwitch: function () {
    var self = this;
    if (this._switchTimer) clearTimeout(this._switchTimer);
    this._switchTimer = setTimeout(function () {
      self.setData({ listSwitch: false });
    }, 280);
  },

  /** 按当前页码切片渲染（分页） */
  applySlice: function () {
    var all = this._filtered || [];
    var size = this.data.pageSize;
    var visible = all.slice(0, this.data.page * size);
    this.setData({
      list: visible,
      hasMore: visible.length < all.length,
      loadingMore: false
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
      allActive: groupId === 'all',
      page: 1,
      listSwitch: true
    }, this.compute.bind(this));
    this.triggerListSwitch();
  },

  gotoGroups: function () {
    wx.navigateTo({ url: '/pages/groups/groups' });
  },

  /* ---------------- 交互 ---------------- */

  onSearch: function (e) {
    this.setData({ query: e.detail.value, page: 1 }, this.compute.bind(this));
  },

  clearSearch: function () {
    this.setData({ query: '', page: 1 }, this.compute.bind(this));
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
      itemList: ['复制 otpauth 链接', '移动到分组', '编辑', '删除'],
      success: function (res) {
        if (res.tapIndex === 0) {
          wx.setClipboardData({ data: otpauth.build(t) });
        } else if (res.tapIndex === 1) {
          self.chooseGroup(id);
        } else if (res.tapIndex === 2) {
          wx.navigateTo({ url: '/pages/input/input?id=' + id });
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
      content: '「' + (t.issuer ? t.issuer + ' · ' : '') + t.label + '」将移入回收站，可在设置里找回。',
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: function (res) {
        if (!res.confirm) return;
        store.remove(id);
        self.reload();
        util.toast('已移入回收站');
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
