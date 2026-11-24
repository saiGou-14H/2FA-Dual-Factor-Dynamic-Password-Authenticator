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
      console.log('[auth] 组件挂载 canAvatar=', canAvatar, 'canNickname=', canNickname);
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
      var tmp = e.detail && e.detail.avatarUrl;
      if (!tmp) return;
      this._avatarGot = true;
      if (this._avatarTimer) clearTimeout(this._avatarTimer);
      this.applyAvatar(tmp);
    },

    /** 点「使用微信头像」后若迟迟没有回调，说明环境不支持，提示改用相册 */
    onAvatarBtnTap: function () {
      var self = this;
      if (this._avatarTimer) clearTimeout(this._avatarTimer);
      this._avatarTimer = setTimeout(function () {
        if (!self._avatarGot) {
          wx.showToast({
            title: '当前环境不支持微信头像，请用相册选择',
            icon: 'none',
            duration: 2500
          });
        }
      }, 1500);
    },

    /** 从相册选择图片（任何环境都可用，作为 chooseAvatar 的兜底） */
    pickFromAlbum: function () {
      var self = this;
      var pick = wx.chooseMedia || wx.chooseImage;
      if (!pick) {
        wx.showToast({ title: '当前环境无法选择图片', icon: 'none' });
        return;
      }
      if (wx.chooseMedia) {
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sizeType: ['compressed'],
          success: function (res) {
            var f = res.tempFiles && res.tempFiles[0];
            if (f) self.applyAvatar(f.tempFilePath);
          }
        });
      } else {
        wx.chooseImage({
          count: 1,
          sizeType: ['compressed'],
          success: function (res) {
            if (res.tempFilePaths && res.tempFilePaths[0]) {
              self.applyAvatar(res.tempFilePaths[0]);
            }
          }
        });
      }
    },

    /** 统一的头像落地：压缩 → 上云 → 失败转 base64 */
    applyAvatar: function (src) {
      var self = this;
      this.compress(src).then(function (small) {
        return self.uploadToCloud(small).then(function (fileID) {
          if (fileID) {
            self.setData({ avatar: fileID });
            return;
          }
          return self.toBase64(small).then(function (b64) {
            self.setData({ avatar: b64 });
          }).catch(function () {
            self.setData({ avatar: small });
          });
        });
      }).catch(function () {
        self.setData({ avatar: src });
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
