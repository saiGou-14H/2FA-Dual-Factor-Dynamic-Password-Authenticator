/**
 * action-sheet —— 自定义操作菜单（替代 wx.showActionSheet）
 * 原生菜单在 Android 上呈深色系统样式，与本应用不一致。
 *
 * 用法：
 *   <action-sheet show="{{show}}" title="账号操作" items="{{items}}"
 *                 bind:select="onAction" bind:close="onClose" />
 *   items: [{ label, value, danger }]
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    items: { type: Array, value: [] },
    cancelText: { type: String, value: '取消' }
  },

  methods: {
    onSelect: function (e) {
      this.triggerEvent('select', { value: e.currentTarget.dataset.value });
    },
    onClose: function () {
      this.triggerEvent('close');
    }
  }
});
