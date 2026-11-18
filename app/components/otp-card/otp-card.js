Component({
  properties: {
    item: {
      type: Object,
      value: {},
      observer: function (val) {
        var name = (val && (val.issuer || val.label)) || '#';
        this.setData({ initial: String(name).slice(0, 1).toUpperCase() });
      }
    }
  },

  data: {
    initial: '#',
    cells: [0, 1, 2]
  },

  methods: {
    onTap: function () {
      this.triggerEvent('toggle', { id: this.data.item.id });
    },
    // 右侧按钮：未显示 → 显示；已显示 → 复制
    onSideTap: function () {
      if (!this.data.item.revealed) {
        this.triggerEvent('toggle', { id: this.data.item.id });
      } else {
        this.triggerEvent('copy', { id: this.data.item.id });
      }
    },
    onReveal: function () {
      this.triggerEvent('toggle', { id: this.data.item.id });
    },
    onLongPress: function () {
      this.triggerEvent('more', { id: this.data.item.id });
    },
    onMore: function () {
      this.triggerEvent('more', { id: this.data.item.id });
    },
    onCopy: function () {
      this.triggerEvent('copy', { id: this.data.item.id });
    }
  }
});
