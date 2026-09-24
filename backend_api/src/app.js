const express = require('express');
const multer = require('multer');
const {
  SESSION_COOKIE,
  authenticateRequest,
  hashPassword,
  login,
  normalizeUsername,
  publicAccount,
  validatePassword
} = require('./auth');
const { createBatchDownload, getOrderImagePreviews, listOrders } = require('./orders');
const {
  getCustomerImage,
  getCustomerImageUrls,
  getCustomerOrder,
  saveCustomerOrder,
  uploadCustomerImages
} = require('./customer');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function success(data, message = 'success') {
  return { code: 200, message, data };
}

function readCookieOptions(env) {
  return {
    httpOnly: true,
    secure: env === 'production',
    // 两个网页端和通用后端使用不同域名时，生产环境必须允许跨站 fetch 携带会话 Cookie。
    // 只有在 Secure 开启时浏览器才接受 SameSite=None。
    sameSite: process.env.ADMIN_COOKIE_SAMESITE || (env === 'production' ? 'None' : 'Lax'),
    maxAge: 8 * 60 * 60,
    path: '/'
  };
}

function serializeCookie(name, value, options) {
  const parts = [name + '=' + encodeURIComponent(value)];
  if (options.maxAge !== undefined) parts.push('Max-Age=' + options.maxAge);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push('SameSite=' + options.sameSite);
  if (options.path) parts.push('Path=' + options.path);
  return parts.join('; ');
}

function createApp({ store, env = 'development', now = () => new Date() }) {
  if (!store) throw new Error('backend api requires a store');
  const app = express();
  const allowedOrigins = (process.env.ADMIN_CORS_ORIGINS || [
    'https://xiaomengtong-d5g5zuan5ae97c4ea-1493143164.tcloudbaseapp.com',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176'
  ].join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });
  app.use(express.json({ limit: '1mb' }));

  const customerImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 2, fileSize: 20 * 1024 * 1024 }
  });

  async function requireAuth(req) {
    const auth = await authenticateRequest(req, store, now());
    if (!auth) throw new HttpError(401, '登录已失效，请重新登录');
    req.auth = auth;
    return auth;
  }

  async function requireAdmin(req) {
    const auth = await requireAuth(req);
    if (auth.account.role !== 'admin') throw new HttpError(403, '只有管理员可以执行此操作');
    return auth;
  }

  app.get('/healthz', (req, res) => res.json({ code: 200, data: { ok: true } }));

  async function customerOrderDetails(req, res, next) {
    try {
      const includePreview = req.query.preview !== '0' && req.query.preview !== 'false';
      return res.json(success(await getCustomerOrder(store, req.params.orderId, { includePreview })));
    } catch (error) {
      return next(error);
    }
  }

  async function customerImageUploadHandler(req, res, next) {
    try {
      const includePreview = req.query.preview !== '0' && req.query.preview !== 'false';
      return res.json(success(await uploadCustomerImages(
        store,
        req.params.orderId,
        req.files,
        { includePreview }
      )));
    } catch (error) {
      return next(error);
    }
  }

  async function customerImageDownloadHandler(req, res, next) {
    try {
      const result = await getCustomerImage(store, req.params.orderId, req.params.side);
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.send(result.fileContent);
    } catch (error) {
      return next(error);
    }
  }

  async function customerImageUrlsHandler(req, res, next) {
    try {
      return res.json(success(await getCustomerImageUrls(store, req.params.orderId)));
    } catch (error) {
      return next(error);
    }
  }

  async function customerOrderSubmit(req, res, next) {
    try {
      return res.json(success(await saveCustomerOrder(store, req.params.orderId, req.body || {}), '提交成功'));
    } catch (error) {
      return next(error);
    }
  }

  // 顾客接口和管理员接口共用 CloudBase 存储，但权限边界完全分开。
  app.get([
    '/api/v1/customer/orders/:orderId',
    '/api/v1/orders/:orderId'
  ], customerOrderDetails);
  app.post([
    '/api/v1/customer/orders/:orderId/images',
    '/api/v1/orders/:orderId/images'
  ], customerImageUpload.fields([
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 }
  ]), customerImageUploadHandler);
  app.get([
    '/api/v1/customer/orders/:orderId/images',
    '/api/v1/orders/:orderId/images'
  ], customerImageUrlsHandler);
  app.get([
    '/api/v1/customer/orders/:orderId/images/:side',
    '/api/v1/orders/:orderId/images/:side'
  ], customerImageDownloadHandler);
  app.put([
    '/api/v1/customer/orders/:orderId',
    '/api/v1/orders/:orderId'
  ], customerOrderSubmit);

  app.post('/api/v1/admin/login', async (req, res, next) => {
    try {
      const body = req.body || {};
      const result = await login(store, body.username ?? body.id, body.password, now());
      if (!result) throw new HttpError(401, '账号或密码错误');
      res.setHeader('Set-Cookie', serializeCookie(
        SESSION_COOKIE,
        result.token,
        readCookieOptions(env)
      ));
      return res.json(success(publicAccount(result.account)));
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/v1/admin/me', async (req, res, next) => {
    try {
      const auth = await requireAuth(req);
      return res.json(success(publicAccount(auth.account)));
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/v1/admin/logout', async (req, res, next) => {
    try {
      const auth = await authenticateRequest(req, store, now());
      if (auth) await store.revokeSession(auth.tokenHash);
      res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, '', {
        ...readCookieOptions(env),
        maxAge: 0
      }));
      return res.json(success(null));
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/v1/admin/orders', async (req, res, next) => {
    try {
      await requireAuth(req);
      return res.json(success(await listOrders(store, req.query)));
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/v1/admin/order-previews', async (req, res, next) => {
    try {
      await requireAuth(req);
      return res.json(success(await getOrderImagePreviews(
        store,
        req.body && req.body.orderIds
      )));
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/v1/admin/batch-download', async (req, res, next) => {
    try {
      await requireAuth(req);
      const result = await createBatchDownload(store, req.body && req.body.orderIds);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="' + result.filename + '"');
      return res.send(result.content);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/v1/admin/accounts', async (req, res, next) => {
    try {
      await requireAdmin(req);
      const accounts = await store.listAccounts();
      return res.json(success(accounts.map(publicAccount)));
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/v1/admin/accounts', async (req, res, next) => {
    try {
      await requireAdmin(req);
      const body = req.body || {};
      const username = normalizeUsername(body.username ?? body.id);
      const password = validatePassword(body.password);
      if (!username || !/^[a-z0-9][a-z0-9._-]{1,31}$/.test(username)) {
        throw new HttpError(400, '账号只能使用 2 到 32 位字母、数字、点、下划线或短横线');
      }
      if (await store.getAccountByUsername(username)) throw new HttpError(409, '账号已存在');
      const account = await store.createAccount({
        username,
        password_hash: await hashPassword(password),
        role: body.role === 'admin' ? 'admin' : 'operator',
        disabled: body.disabled === true,
        created_at: now(),
        updated_at: now()
      });
      return res.status(201).json(success(publicAccount(account)));
    } catch (error) {
      return next(error);
    }
  });

  async function updateAccount(req, res, next) {
    try {
      const auth = await requireAuth(req);
      const targetId = !req.params.id || req.params.id === 'me' ? auth.account._id : req.params.id;
      const body = req.body || {};
      const isAdmin = auth.account.role === 'admin';
      if (!isAdmin && targetId !== auth.account._id) {
        throw new HttpError(403, '普通用户只能修改自己的密码');
      }
      const keys = Object.keys(body);
      if (!isAdmin && keys.some((key) => key !== 'password')) {
        throw new HttpError(403, '普通用户只能修改自己的密码');
      }
      const target = await store.getAccountById(targetId);
      if (!target) throw new HttpError(404, '账号不存在');
      const patch = { updated_at: now() };
      if (body.password !== undefined) patch.password_hash = await hashPassword(validatePassword(body.password));
      if (isAdmin) {
        if (body.role !== undefined) {
          if (!['admin', 'operator'].includes(body.role)) throw new HttpError(400, '账号角色不正确');
          patch.role = body.role;
        }
        if (body.disabled !== undefined) patch.disabled = body.disabled === true;
        if (patch.disabled === true && target.role === 'admin' && await store.countActiveAdmins() <= 1) {
          throw new HttpError(400, '不能禁用唯一的管理员账号');
        }
      }
      await store.updateAccount(targetId, patch);
      return res.json(success(publicAccount({ ...target, ...patch })));
    } catch (error) {
      return next(error);
    }
  }

  app.patch('/api/v1/admin/accounts/me/password', updateAccount);
  app.patch('/api/v1/admin/accounts/:id', updateAccount);

  app.use((error, req, res, next) => {
    const status = error.status
      || (error instanceof multer.MulterError
        ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
        : 500);
    if (status >= 500) console.error('backend api error', error);
    return res.status(status).json({
      code: status,
      message: status >= 500
        ? (status === 413 ? '图片不能超过 20MB' : '后台服务暂时不可用')
        : error.message
    });
  });

  return app;
}

module.exports = { createApp, HttpError };
