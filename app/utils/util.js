'use strict';

/** 补零 */
function pad(n, len) {
  var s = String(n);
  while (s.length < (len || 2)) s = '0' + s;
  return s;
}

/** 时间显示 HH:MM:SS */
function hhmmss(ts) {
  var d = new Date(ts || Date.now());
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

/** 日期显示 YYYY-MM-DD */
function ymd(ts) {
  var d = new Date(ts || Date.now());
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** 相对日期显示：今天 20:33 / 昨天 18:12 / 11月15日 09:40 / 2025年11月15日 */
function friendlyTime(ts) {
  if (!ts) return '';
  var d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '';
  var now = new Date();
  var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());

  var dayStart = function (x) {
    return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  };
  var diffDays = Math.round((dayStart(now) - dayStart(d)) / 86400000);

  if (diffDays === 0) return '今天 ' + hm;
  if (diffDays === 1) return '昨天 ' + hm;
  if (diffDays > 1 && diffDays < 7) return diffDays + ' 天前 ' + hm;
  if (d.getFullYear() === now.getFullYear()) {
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
  }
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

/** 验证码分组显示：123456 -> 123 456 */
/** 轻提示 */
function toast(title, icon) {
  wx.showToast({ title: title, icon: icon || 'none', duration: 1500 });
}

/**
 * 自定义导航栏度量（custom navigation 必须据此让开胶囊按钮）。
 * 返回 { statusBarHeight, navBarHeight, menuRightSpace, menuHeight }
 * - navBarHeight：标题栏内容高度（胶囊垂直居中）
 * - menuRightSpace：屏幕右边缘到胶囊左边缘的距离（px），标题栏内容右边界据此让位
 */
function navMetrics() {
  var app = getApp();
  var win = app.globalData.windowInfo || {};
  var menu = app.globalData.menuButton || null;

  var statusBarHeight = win.statusBarHeight || 20;
  var screenWidth = win.screenWidth || win.windowWidth || 375;

  if (menu) {
    var menuHeight = menu.height || 32;
    var topGap = Math.max(0, (menu.top || 0) - statusBarHeight);
    var navBarHeight = Math.round(topGap * 2 + menuHeight);
    var menuRightSpace = Math.round(screenWidth - menu.left + 8); // 胶囊宽 + 右边距 + 8px 呼吸
    return {
      statusBarHeight: statusBarHeight,
      navBarHeight: navBarHeight,
      menuRightSpace: menuRightSpace,
      menuHeight: menuHeight
    };
  }

  // 兜底（拿不到胶囊时按常见值估算）
  return {
    statusBarHeight: statusBarHeight,
    navBarHeight: 44,
    menuRightSpace: 96,
    menuHeight: 32
  };
}

module.exports = {
  hhmmss: hhmmss,
  ymd: ymd,
  friendlyTime: friendlyTime,
  toast: toast,
  navMetrics: navMetrics
};
