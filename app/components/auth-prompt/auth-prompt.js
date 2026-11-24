/**
 * auth-prompt —— 微信身份授权引导
 *
 * 微信自 2022-10 起不再开放读取昵称的接口，唯一合规路径是：
 *   头像：<button open-type="chooseAvatar"> → 临时路径 → 压缩
 *         → 优先上传云存储（得到 cloud:// fileID）
 *         → 上传失败则退回 base64 存本机+云端
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
        return self.uploadToCloud(small).then(function (fileID) {
          if (fileID) {
            // 优先用云存储 fileID：数据库只存几十字节，图片走 CDN
            self.setData({ avatar: fileID });
            return;
          }
          // 云存储不可用 → 退回 base64
          return self.toBase64(small).then(function (b64) {
            self.setData({ avatar: b64 });
          }).catch(function () {
            self.setData({ avatar: small });
          });
        });
      }).catch(function () {
        // 压缩失败就用原图，尽量不让授权中断
        self.setData({ avatar: tmp });
      });
    },

    /** 压缩到 96px，返回临时文件路径 */
    compress: function (src) {
      return new Promise(function (resolve) {
        if (!wx.compressImage) return resolve(src);
        wx.compressImage({
          src: src,
          quality: AVATAR_QUALITY,
          compressedWidth: AVATAR_WIDTH,
          success: function (res) { resolve(res.tempFilePath || src); },
          fail: function () { resolve(src); }
        });
      });
    },

    /**
     * 上传到云存储，返回 fileID（cloud://...）。
     * 失败返回空串，由调用方退回 base64。
     */
    uploadToCloud: function (filePath) {
      return new Promise(function (resolve) {
        if (!wx.cloud || !wx.cloud.uploadFile) return resolve('');
        var rand = Math.random().toString(36).slice(2, 8);
        var cloudPath = 'avatars/' + Date.now() + '-' + rand + '.png';
        wx.cloud.uploadFile({
          cloudPath: cloudPath,
          filePath: filePath,
          success: function (res) { resolve(res.fileID || ''); },
          fail: function () { resolve(''); }
        });
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
