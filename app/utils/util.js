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

/** 验证码分组显示：123456 -> 123 456 */
function groupCode(code, size) {
  var s = String(code || '');
  var step = size || 3;
  var out = [];
  for (var i = 0; i < s.length; i += step) out.push(s.slice(i, i + step));
  return out.join(' ');
}

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
  pad: pad, hhmmss: hhmmss, ymd: ymd, groupCode: groupCode, toast: toast,
  navMetrics: navMetrics
};
