/**
 * select-sheet —— 通用底部选择器
 * 替代原生 <picker>：原生 picker 在真机上会弹出深色系统浮层，与本应用亮色主题冲突且无法定制。
 *
 * 用法：
 *   <select-sheet show="{{sheet.show}}" title="{{sheet.title}}"
 *                 options="{{sheet.options}}" value="{{sheet.value}}"
 *                 bind:select="onSheetSelect" bind:close="closeSheet" />
 *   options: [{ label, value, meta }]
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '请选择' },
    options: { type: Array, value: [] },
    value: { type: String, value: '' }
  },

  methods: {
    onSelect: function (e) {
      var value = e.currentTarget.dataset.value;
      this.triggerEvent('select', { value: value });
    },
    onClose: function () {
      this.triggerEvent('close');
    }
  }
});
