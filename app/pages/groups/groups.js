var store = require('../../utils/store.js');
var util = require('../../utils/util.js');
var app = getApp();

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    menuRightSpace: 96,
    groups: [],
    groupName: '',
    editingId: '',
    editingName: '',
    // 拖拽态
    dragging: false,
    dragId: '',
    dragName: '',
    dragCount: 0,
    dragBuiltin: false,
    dragTop: 0,
    showTargetSheet: false,
    pendingDeleteGroupId: '',
    targetGroups: []
  },

  onLoad: function (options) {
    var nav = util.navMetrics();
    this._fromInput = !!(options && options.from === 'input');
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      menuRightSpace: nav.menuRightSpace
    });
    this.reload();
  },

  onShow: function () {
    this.reload();
  },

  onReady: function () {
    this.measureRows();
  },

  /* ---------------- 数据 ---------------- */

  reload: function (remeasure) {
    this.setData({ groups: store.groups() });
    if (remeasure !== false) {
      var self = this;
      // 等一帧再测量，保证拿到最新布局
      setTimeout(function () { self.measureRows(); }, 40);
    }
  },

  /** 缓存行高与列表顶部位置，供拖拽计算 */
  measureRows: function () {
    var self = this;
    wx.createSelectorQuery()
      .selectAll('.group-row')
      .boundingClientRect(function (rects) {
        if (!rects || !rects.length) {
          self._rowH = 0;
          return;
        }
        self._rowH = rects[0].height;
        self._listTop = rects[0].top;
      })
      .exec();
  },

  onBack: function () {
    wx.navigateBack();
  },

  /* ---------------- 新建 ---------------- */

  onGroupName: function (e) {
    this.setData({ groupName: e.detail.value });
  },

  createGroup: function () {
    var result = store.addGroup(this.data.groupName);
    if (result.error) {
      util.toast(result.error);
      return;
    }
    if (this._fromInput) app.globalData.lastCreatedGroupId = result.group.id;
    this.setData({ groupName: '' });
    this.reload();
    util.toast('已创建分组', 'success');
  },

  /* ---------------- 重命名 ---------------- */

  startRename: function (e) {
    var group = store.groups().find(function (item) { return item.id === e.currentTarget.dataset.id; });
    if (!group || group.builtin) return;
    this.setData({ editingId: group.id, editingName: group.name });
  },

  onRenameInput: function (e) {
    this.setData({ editingName: e.detail.value });
  },

  cancelRename: function () {
    this.setData({ editingId: '', editingName: '' });
  },

  saveRename: function () {
    var result = store.renameGroup(this.data.editingId, this.data.editingName);
    if (result.error) {
      util.toast(result.error);
      return;
    }
    this.setData({ editingId: '', editingName: '' });
    this.reload();
    util.toast('已重命名', 'success');
  },

  /* ---------------- 删除 ---------------- */

  deleteGroup: function (e) {
    var groupId = e.currentTarget.dataset.id;
    var groups = store.groups();
    var group = groups.find(function (item) { return item.id === groupId; });
    if (!group || group.builtin) return;
    var targets = groups.filter(function (item) { return item.id !== groupId; });
    if (group.count) {
      this.setData({
        showTargetSheet: true,
        pendingDeleteGroupId: groupId,
        targetGroups: targets
      });
      return;
    }
    var defaultTarget = targets.find(function (item) { return item.id === store.PERSONAL_GROUP_ID; }) || targets[0];
    this.confirmDelete(groupId, defaultTarget.id);
  },

  closeTargetSheet: function () {
    this.setData({ showTargetSheet: false, pendingDeleteGroupId: '', targetGroups: [] });
  },

  selectDeleteTarget: function (e) {
    var groupId = this.data.pendingDeleteGroupId;
    var targetId = e.currentTarget.dataset.id;
    this.closeTargetSheet();
    this.confirmDelete(groupId, targetId);
  },

  confirmDelete: function (groupId, targetId) {
    var self = this;
    var groups = store.groups();
    var group = groups.find(function (item) { return item.id === groupId; });
    var target = groups.find(function (item) { return item.id === targetId; });
    if (!group || !target) return;
    wx.showModal({
      title: '删除分组',
      content: group.count
        ? '将 ' + group.count + ' 个账号移入「' + target.name + '」，然后删除「' + group.name + '」。'
        : '删除空分组「' + group.name + '」？',
      confirmText: '删除',
      cancelText: '取消',
      confirmColor: '#dc2626',
      success: function (res) {
        if (!res.confirm) return;
        var result = store.deleteGroup(groupId, targetId);
        if (result.error) {
          util.toast(result.error);
          return;
        }
        self.reload();
        util.toast('已删除分组', 'success');
      },
      fail: function (err) {
        console.error('[deleteGroup] 确认框失败', err);
        util.toast('确认框打开失败');
      }
    });
  },

  /* ---------------- 排序：点箭头，立即生效 ---------------- */

  moveGroup: function (e) {
    var index = Number(e.currentTarget.dataset.index);
    var direction = Number(e.currentTarget.dataset.direction);
    var next = index + direction;
    var groups = this.data.groups;
    if (next < 0 || next >= groups.length) return;
    this.applyOrder(this.swappedIds(groups, index, next));
  },

  /** 生成交换两位后的 id 顺序 */
  swappedIds: function (groups, from, to) {
    var ids = groups.map(function (group) { return group.id; });
    var moved = ids[from];
    ids[from] = ids[to];
    ids[to] = moved;
    return ids;
  },

  /** 落库 + 刷新（无保存按钮，改了就算数） */
  applyOrder: function (ids) {
    store.reorderGroups(ids);
    this.reload();
  },

  /* ---------------- 排序：拖拽（悬浮跟手） ---------------- */

  onDragStart: function (e) {
    var index = Number(e.currentTarget.dataset.index);
    var group = this.data.groups[index];
    if (!group) return;

    var y = e.touches[0].clientY;
    var rowH = this._rowH || 128;
    var rowTop = (this._listTop || 0) + index * rowH;

    this._drag = {
      startY: y,
      grab: y - rowTop           // 手指在行内的抓取偏移，保持悬浮层不跳
    };

    this.setData({
      dragging: true,
      dragId: group.id,
      dragName: group.name,
      dragCount: group.count,
      dragBuiltin: !!group.builtin,
      dragTop: rowTop
    });

    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });
  },

  onDragMove: function (e) {
    var drag = this._drag;
    if (!drag) return;

    var y = e.touches[0].clientY;
    var rowH = this._rowH || 128;

    // 悬浮层始终跟随手指
    this.setData({ dragTop: y - drag.grab });

    // 跨过半行高即换位
    var steps = Math.round((y - drag.startY) / rowH);
    if (!steps) return;

    var groups = this.data.groups;
    var from = groups.findIndex(function (g) { return g.id === this.data.dragId; }, this);
    if (from < 0) return;

    var to = Math.max(0, Math.min(groups.length - 1, from + steps));
    if (to === from) return;

    var next = groups.slice();
    var dir = to > from ? 1 : -1;
    while (from !== to) {
      var moved = next[from];
      next[from] = next[from + dir];
      next[from + dir] = moved;
      from += dir;
    }

    drag.startY = y;             // 重置基线，避免误差累积
    this.setData({ groups: next });
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });
  },

  onDragEnd: function () {
    var drag = this._drag;
    this._drag = null;
    if (!drag) return;

    // 松手才落库，避免拖动过程中频繁写存储
    var ids = this.data.groups.map(function (group) { return group.id; });
    store.reorderGroups(ids);

    this.setData({
      dragging: false,
      dragId: '',
      dragName: '',
      dragCount: 0,
      dragBuiltin: false,
      dragTop: 0
    });
    this.reload(false);
  }
});
