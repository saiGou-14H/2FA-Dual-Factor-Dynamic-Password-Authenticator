var totp = require('../../utils/totp.js');
var store = require('../../utils/store.js');
var util = require('../../utils/util.js');
var otpauth = require('../../utils/otpauth.js');
var vault = require('../../utils/vault.js');
var sync = require('../../utils/sync.js');
var cloudSync = require('../../utils/cloud-sync.js');

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
    listAnim: '',
    tabInto: '',
    // 账号操作菜单
    showTokenSheet: false,
    tokenSheetTitle: '',
    tokenSheetItems: [],
    activeTokenId: ''
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
    if (app.globalData.vaultDirty) {
      app.globalData.vaultDirty = false;
      this.setData({ page: 1 });
    }
    this.reload();
    this.startTick();
  },

  onHide: function () { this.stopTick(); },
  onUnload: function () { this.stopTick(); },

  /* ---------------- 下拉刷新 ---------------- */

  /** 重新读取本地数据（下拉刷新 / 外部改动后） */
  doRefresh: function () {
    this._tokens = store.list();
    var groups = store.groups();
    var selected = this.data.selectedGroupId;
    if (selected !== 'all' && !groups.some(function (g) { return g.id === selected; })) {
      selected = 'all';
    }
    this.setData({
      groups: groups,
      selectedGroupId: selected,
      allActive: selected === 'all',
      page: 1
    });
    this._revealed = {};
    this.compute();
  },

  /** scroll-view 下拉刷新 */
  onRefresh: function () {
    var self = this;
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    this.doRefresh();
    setTimeout(function () {
      self.setData({ refreshing: false });
      util.toast('已刷新');
    }, 520);
  },

  /** 页面级下拉（保留兼容，当前未启用） */
  onPullDownRefresh: function () {
    this.doRefresh();
    if (wx.stopPullDownRefresh) wx.stopPullDownRefresh();
  },

  /** scroll-view 触底 */
  onScrollToLower: function () {
    this.onReachBottom();
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

  /** 列表切换动画：dir 为 1 表示往下一个分组（内容从右滑入） */
  playListAnim: function (dir) {
    var self = this;
    if (this._switchTimer) clearTimeout(this._switchTimer);
    this.setData({ listAnim: dir > 0 ? 'is-slide-next' : 'is-slide-prev' });
    this._switchTimer = setTimeout(function () {
      self.setData({ listAnim: '' });
    }, 320);
  },

  /** 当前分组在标签序列中的位置（0 = 全部） */
  groupIndexById: function (groupId) {
    if (groupId === 'all') return 0;
    var groups = this.data.groups || [];
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].id === groupId) return i + 1;
    }
    return 0;
  },

  /** 按位置取分组 id */
  groupIdByIndex: function (index) {
    if (index <= 0) return 'all';
    var groups = this.data.groups || [];
    var group = groups[index - 1];
    return group ? group.id : 'all';
  },

  /** 切换到指定分组（带方向动画，标签自动滚到可见） */
  switchGroup: function (groupId) {
    if (!groupId || groupId === this.data.selectedGroupId) return;
    var from = this.groupIndexById(this.data.selectedGroupId);
    var to = this.groupIndexById(groupId);
    this.setData({
      selectedGroupId: groupId,
      allActive: groupId === 'all',
      page: 1,
      tabInto: 'tab-' + groupId
    }, this.compute.bind(this));
    this.playListAnim(to >= from ? 1 : -1);
  },

  /** 左右滑动切换：dir=1 下一个，dir=-1 上一个 */
  switchGroupByStep: function (dir) {
    var total = (this.data.groups || []).length + 1;   // 含「全部」
    var current = this.groupIndexById(this.data.selectedGroupId);
    var next = current + dir;
    if (next < 0 || next >= total) return false;
    this.switchGroup(this.groupIdByIndex(next));
    return true;
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
    this.switchGroup(e.currentTarget.dataset.id);
  },

  /* ---------------- 左右滑动切换分组 ---------------- */

  onSwipeStart: function (e) {
    var t = e.touches && e.touches[0];
    if (!t) return;
    this._swipe = { x: t.clientX, y: t.clientY, at: Date.now(), locked: '' };
  },

  onSwipeMove: function (e) {
    var t = e.touches && e.touches[0];
    var swipe = this._swipe;
    if (!t || !swipe) return;
    var dx = t.clientX - swipe.x;
    var dy = t.clientY - swipe.y;
    if (!swipe.locked && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) {
      // 首次判定方向：横向明显大于纵向才算滑动切换
      swipe.locked = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y';
    }
  },

  onSwipeEnd: function (e) {
    var swipe = this._swipe;
    this._swipe = null;
    if (!swipe) return;
    if (swipe.locked !== 'x') return;
    var t = (e.changedTouches && e.changedTouches[0]) || null;
    if (!t) return;
    var dx = t.clientX - swipe.x;
    var dy = t.clientY - swipe.y;
    var dt = Date.now() - swipe.at;
    // 位移够远且够快，才认定为切换手势
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.2 || dt > 800) return;
    this.switchGroupByStep(dx < 0 ? 1 : -1);
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
    var id = e.detail ? e.detail.id : e.currentTarget.dataset.id;
    var t = (this._tokens || []).find(function (item) { return item.id === id; });
    if (!t) return;
    this.setData({
      showTokenSheet: true,
      activeTokenId: id,
      tokenSheetTitle: (t.issuer ? t.issuer + ' · ' : '') + t.label,
      tokenSheetItems: [
        { label: '复制 otpauth 链接', value: 'copy' },
        { label: '移动到分组', value: 'move' },
        { label: '编辑', value: 'edit' },
        { label: '删除', value: 'delete', danger: true }
      ]
    });
  },

  closeTokenSheet: function () {
    this.setData({ showTokenSheet: false, tokenSheetItems: [], tokenSheetTitle: '' });
  },

  onTokenAction: function (e) {
    var action = e.detail.value;
    var id = this.data.activeTokenId;
    var t = (this._tokens || []).find(function (item) { return item.id === id; });
    this.closeTokenSheet();
    if (!t) return;
    if (action === 'copy') {
      wx.setClipboardData({ data: otpauth.build(t) });
    } else if (action === 'move') {
      this.chooseGroup(id);
    } else if (action === 'edit') {
      wx.navigateTo({ url: '/pages/input/input?id=' + id });
    } else if (action === 'delete') {
      this.confirmDelete(id, t);
    }
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
