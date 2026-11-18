var store = require('../../utils/store.js');
var util = require('../../utils/util.js');

var app = getApp();

// 筛选预设（毫秒）
var PRESETS = {
  all: 0,
  today: 0,
  d7: 7 * 86400000,
  d30: 30 * 86400000
};

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    menuRightSpace: 96,
    filter: 'all',
    startDate: '',
    endDate: '',
    list: [],
    total: 0,
    rangeText: '',
    loadingShow: false,
    loadingText: '处理中'
  },

  onLoad: function () {
    var nav = util.navMetrics();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      menuRightSpace: nav.menuRightSpace
    });
  },

  onShow: function () {
    this.reload();
  },

  onBack: function () {
    wx.navigateBack();
  },

  showLoading: function (text) {
    this.setData({ loadingShow: true, loadingText: text || '处理中' });
  },

  hideLoading: function () {
    if (this.data.loadingShow) this.setData({ loadingShow: false });
  },

  /* ================= 筛选 ================= */

  setFilter: function (e) {
    var f = e.currentTarget.dataset.filter;
    if (f === this.data.filter) return;
    this.setData({ filter: f }, this.reload.bind(this));
  },

  onStartDate: function (e) {
    this.setData({ startDate: e.detail.value, filter: 'custom' }, this.reload.bind(this));
  },

  onEndDate: function (e) {
    this.setData({ endDate: e.detail.value, filter: 'custom' }, this.reload.bind(this));
  },

  /** 计算当前筛选的时间区间 [from, to] 与展示文案 */
  currentRange: function () {
    var now = Date.now();
    var f = this.data.filter;

    if (f === 'today') {
      var d = new Date();
      var start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      return { from: start, to: now, text: '今天删除的' };
    }
    if (f === 'd7') {
      return { from: now - PRESETS.d7, to: now, text: '近 7 天删除的' };
    }
    if (f === 'd30') {
      return { from: now - PRESETS.d30, to: now, text: '近 30 天删除的' };
    }
    if (f === 'custom') {
      var s = this.data.startDate;
      var e = this.data.endDate;
      var from = s ? new Date(s + 'T00:00:00').getTime() : 0;
      var to = e ? new Date(e + 'T23:59:59').getTime() : now;
      var text = (s || e)
        ? ((s || '最早') + ' 至 ' + (e || '现在'))
        : '全部时间';
      return { from: from, to: to, text: text };
    }
    return { from: 0, to: now + 1, text: '全部时间' };
  },

  /* ================= 数据 ================= */

  reload: function () {
    var range = this.currentRange();
    var groups = store.groups();
    var nameOf = {};
    groups.forEach(function (g) { nameOf[g.id] = g.name; });

    var deleted = store.deletedList().filter(function (t) {
      var at = Number(t.deletedAt) || 0;
      return at >= range.from && at <= range.to;
    });

    var list = deleted.map(function (t) {
      return {
        id: t.id,
        issuer: t.issuer,
        label: t.label,
        groupName: nameOf[t.groupId] || '',
        deletedAt: t.deletedAt,
        deletedText: util.friendlyTime(t.deletedAt)
      };
    });

    this.setData({
      list: list,
      total: store.deletedCount(),
      rangeText: range.text
    });
  },

  /* ================= 操作 ================= */

  onRestore: function (e) {
    var id = e.currentTarget.dataset.id;
    var ok = store.restore(id);
    if (ok) {
      util.toast('已恢复', 'success');
      this.reload();
    } else {
      util.toast('恢复失败');
    }
  },

  onPurge: function (e) {
    var self = this;
    var id = e.currentTarget.dataset.id;
    var name = e.currentTarget.dataset.name || '该账号';
    wx.showModal({
      title: '彻底删除',
      content: '「' + name + '」将被永久删除，无法恢复。继续？',
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: function (res) {
        if (!res.confirm) return;
        store.purge(id);
        util.toast('已彻底删除');
        self.reload();
      }
    });
  },

  purgeAll: function () {
    var self = this;
    if (this.data.total === 0) {
      util.toast('回收站已经是空的');
      return;
    }
    wx.showModal({
      title: '清空回收站',
      content: '将永久删除回收站内全部 ' + this.data.total + ' 个账号，无法恢复。继续？',
      confirmText: '清空',
      confirmColor: '#dc2626',
      success: function (res) {
        if (!res.confirm) return;
        self.showLoading('正在清空');
        setTimeout(function () {
          var n = store.purgeDeleted();
          self.hideLoading();
          util.toast('已清空 ' + n + ' 个账号');
          self.reload();
        }, 60);
      }
    });
  }
});
