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
    orderChanged: false,
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
    if (!this._draftIds) this.reload();
  },

  reload: function () {
    var groups = store.groups();
    this._draftIds = groups.map(function (group) { return group.id; });
    this.setData({ groups: groups, orderChanged: false });
  },

  onBack: function () {
    wx.navigateBack();
  },

  onGroupName: function (e) {
    this.setData({ groupName: e.detail.value });
  },

  createGroup: function () {
    var result = store.addGroup(this.data.groupName);
    if (result.error) {
      util.toast(result.error);
      return;
    }
    this._draftIds.push(result.group.id);
    if (this._fromInput) app.globalData.lastCreatedGroupId = result.group.id;
    this.setData({ groupName: '', orderChanged: true });
    this.refreshDraftGroups();
    util.toast('已创建分组', 'success');
  },

  refreshDraftGroups: function () {
    var groups = store.groups();
    var positions = {};
    this._draftIds.forEach(function (id, index) { positions[id] = index; });
    groups.sort(function (a, b) { return positions[a.id] - positions[b.id]; });
    this.setData({ groups: groups });
  },

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
    this.setData({ editingId: '', editingName: '', orderChanged: true });
    this.refreshDraftGroups();
    util.toast('已重命名', 'success');
  },

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
      confirmText: group.count ? '删除并移动' : '删除',
      confirmColor: '#dc2626',
      success: function (res) {
        if (!res.confirm) return;
        var result = store.deleteGroup(groupId, targetId);
        if (result.error) {
          util.toast(result.error);
          return;
        }
        self._draftIds = self._draftIds.filter(function (id) { return id !== groupId; });
        self.setData({ orderChanged: true });
        self.refreshDraftGroups();
        util.toast('已删除分组', 'success');
      }
    });
  },

  moveGroup: function (e) {
    var index = Number(e.currentTarget.dataset.index);
    var direction = Number(e.currentTarget.dataset.direction);
    var next = index + direction;
    if (next < 0 || next >= this._draftIds.length) return;
    var ids = this._draftIds.slice();
    var moved = ids[index];
    ids[index] = ids[next];
    ids[next] = moved;
    this._draftIds = ids;
    this.setData({ orderChanged: true });
    this.refreshDraftGroups();
  },

  saveOrder: function () {
    store.reorderGroups(this._draftIds);
    this.setData({ orderChanged: false });
    util.toast('显示顺序已保存', 'success');
  }
});
