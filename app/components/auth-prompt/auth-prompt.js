/**
 * auth-prompt —— 微信身份授权引导
 *
 * 微信自 2022-10 起不再开放读取昵称的接口，唯一合规路径是：
 *   头像：<button open-type="chooseAvatar"> → 临时路径 → 压缩 → base64
 *   昵称：<input type="nickname"> → 键盘上方选「微信昵称」
 *
 * 结果写入 store.getProfile()，随加密保险库同步。
 */
var store = require('../../utils/store.js');
var cloudSync = require('../../utils/cloud-sync.js');

// 头像压缩参数：够小，避免撑大密文
var AVATAR_WIDTH = 96;
var AVATAR_QUALITY = 60;

Component({
  properties: {
    show: { type: Boolean, value: false }
  },

  data: {
    nickname: '',
    avatar: '',
    saving: false,
    canUseAvatar: true,
    canUseNickname: true
  },

  lifetimes: {
    attached: function () {
      var canAvatar = true;
      var canNickname = true;
      try {
        canAvatar = wx.canIUse('button.open-type.chooseAvatar');
      } catch (e) { canAvatar = true; }
      try {
        canNickname = wx.canIUse('input.type.nickname');
      } catch (e) { canNickname = true; }
      this.setData({ canUseAvatar: canAvatar, canUseNickname: canNickname });
    }
  },

  observers: {
    show: function (v) {
      if (v) {
        var p = store.getProfile();
        this.setData({
          nickname: p.nickname || '',
          avatar: p.avatar || ''
        });
      }
    }
  },

  methods: {
    /** 用户选择微信头像 */
    onChooseAvatar: function (e) {
      var self = this;
      var tmp = e.detail && e.detail.avatarUrl;
      if (!tmp) return;
      this.compress(tmp).then(function (small) {
        self.setData({ avatar: small });
      }).catch(function () {
        // 压缩失败就用原图，尽量不让授权中断
        self.setData({ avatar: tmp });
      });
    },

    /** 压缩并转 base64（压缩失败返回原路径） */
    compress: function (src) {
      var self = this;
      return new Promise(function (resolve, reject) {
        if (!wx.compressImage) return resolve(src);
        wx.compressImage({
          src: src,
          quality: AVATAR_QUALITY,
          compressedWidth: AVATAR_WIDTH,
          success: function (res) { resolve(res.tempFilePath || src); },
          fail: function () { resolve(src); }
        });
      }).then(function (path) {
        return self.toBase64(path).catch(function () { return path; });
      });
    },

    toBase64: function (path) {
      return new Promise(function (resolve, reject) {
        if (String(path).indexOf('data:') === 0) return resolve(path);
        wx.getFileSystemManager().readFile({
          filePath: path,
          encoding: 'base64',
          success: function (res) {
            resolve('data:image/png;base64,' + res.data);
          },
          fail: reject
        });
      });
    },

    onNickname: function (e) {
      this.setData({ nickname: (e.detail && e.detail.value) || '' });
    },

    onConfirm: function () {
      if (this.data.saving) return;
      var nickname = String(this.data.nickname || '').trim();
      if (!nickname) {
        wx.showToast({ title: '请选择微信昵称', icon: 'none' });
        return;
      }
      if (nickname.length > 20) nickname = nickname.slice(0, 20);

      var profile = store.setProfile({
        nickname: nickname,
        avatar: this.data.avatar || '',
        authorized: true
      });
      this.setData({ saving: false });
      // 同步到云端（明文，重装小程序后可自动恢复）
      cloudSync.saveProfile(profile).catch(function () { /* 离线忽略，下次授权会补 */ });
      this.triggerEvent('done', profile);
    },

    onSkip: function () {
      this.triggerEvent('skip');
    }
  }
});
