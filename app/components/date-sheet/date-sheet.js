/**
 * date-sheet —— 自定义日期选择（替代原生 <picker mode="date">）
 * 原生日期选择器在真机上是深色系统浮层，与本应用亮色主题冲突。
 *
 * 用法：
 *   <date-sheet show="{{show}}" title="开始日期" value="{{startDate}}"
 *               bind:select="onPick" bind:close="onClose" />
 *   select 事件返回 { value: 'YYYY-MM-DD' }
 */
function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '选择日期' },
    value: { type: String, value: '' },
    yearSpan: { type: Number, value: 6 }
  },

  data: {
    years: [],
    months: [],
    days: [],
    selY: 0,
    selM: 1,
    selD: 1,
    yearInto: '',
    monthInto: '',
    dayInto: ''
  },

  observers: {
    show: function (show) {
      if (show) this.reset();
    },
    value: function () {
      if (this.data.show) this.reset();
    }
  },

  methods: {
    reset: function () {
      var now = new Date();
      var maxYear = now.getFullYear();
      var years = [];
      for (var y = maxYear; y > maxYear - (this.data.yearSpan || 6); y--) years.push(y);
      var months = [];
      for (var m = 1; m <= 12; m++) months.push(m);

      var parts = String(this.properties.value || '').split('-');
      var selY = Number(parts[0]) || maxYear;
      var selM = Number(parts[1]) || (now.getMonth() + 1);
      var selD = Number(parts[2]) || now.getDate();
      if (years.indexOf(selY) < 0) {
        years.unshift(selY);
      }
      if (selM < 1 || selM > 12) selM = 1;

      var days = this.daysIn(selY, selM);
      if (selD < 1 || selD > days) selD = Math.min(selD, days);

      this.setData({
        years: years,
        months: months,
        days: this.dayList(days),
        selY: selY,
        selM: selM,
        selD: selD,
        yearInto: 'y-' + selY,
        monthInto: 'm-' + selM,
        dayInto: 'd-' + selD
      });
    },

    daysIn: function (y, m) {
      return new Date(y, m, 0).getDate();
    },

    dayList: function (n) {
      var out = [];
      for (var i = 1; i <= n; i++) out.push(i);
      return out;
    },

    onPickYear: function (e) {
      var y = Number(e.currentTarget.dataset.v);
      var days = this.daysIn(y, this.data.selM);
      var d = Math.min(this.data.selD, days);
      this.setData({
        selY: y,
        selD: d,
        days: this.dayList(days),
        yearInto: 'y-' + y,
        dayInto: 'd-' + d
      });
    },

    onPickMonth: function (e) {
      var m = Number(e.currentTarget.dataset.v);
      var days = this.daysIn(this.data.selY, m);
      var d = Math.min(this.data.selD, days);
      this.setData({
        selM: m,
        selD: d,
        days: this.dayList(days),
        monthInto: 'm-' + m,
        dayInto: 'd-' + d
      });
    },

    onPickDay: function (e) {
      var d = Number(e.currentTarget.dataset.v);
      this.setData({ selD: d, dayInto: 'd-' + d });
    },

    onConfirm: function () {
      var d = this.data;
      var value = d.selY + '-' + pad(d.selM) + '-' + pad(d.selD);
      this.triggerEvent('select', { value: value });
    },

    onClose: function () {
      this.triggerEvent('close');
    }
  }
});
