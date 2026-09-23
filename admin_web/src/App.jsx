// 后台订单列表：类型搜索、相对时间和批量下载入口集中在此页面。
import { useEffect, useState } from 'react';
import {
  batchDownload,
  createAccount,
  getCurrentUser,
  listOrders,
  listAccounts,
  signIn,
  signOut,
  updateAccount
} from './backend';
import { formatRelativeTime, getOrderUpdatedTime, getOrderUploadTime } from './utils/time.js';
import { detectPlatform } from './utils/platform.js';

const EMPTY_FILTERS = {
  order_id: '',
  platform: '',
  shop: '',
  product_name: '',
  notebook_type: '',
  status: '',
  created_from: '',
  created_to: ''
};

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [operator, setOperator] = useState(null);
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [notebookTypes, setNotebookTypes] = useState([]);
  const [notebookTypeOpen, setNotebookTypeOpen] = useState(false);
  const [orders, setOrders] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [view, setView] = useState('orders');
  const [accounts, setAccounts] = useState([]);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountMessage, setAccountMessage] = useState('');
  const [imagePreview, setImagePreview] = useState(null);
  const [imagePreviewSize, setImagePreviewSize] = useState(null);
  const [accountForm, setAccountForm] = useState({
    username: '',
    password: '',
    role: 'operator'
  });
  const [selfPassword, setSelfPassword] = useState('');
  const [accountPasswordDrafts, setAccountPasswordDrafts] = useState({});
  const dateRangeInvalid = Boolean(
    filters.created_from
    && filters.created_to
    && filters.created_to < filters.created_from
  );

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      try {
        const user = await getCurrentUser();
        if (active && user) {
          setOperator(user);
          setLoggedIn(true);
        }
      } catch {
        // 未登录时 CloudBase 可能返回认证状态错误，保持登录页即可。
      } finally {
        if (active) setSessionLoading(false);
      }
    }

    restoreSession();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loggedIn) loadOrders(1);
  }, [loggedIn]);

  async function handleLogin(event) {
    event.preventDefault();
    setMessage('');
    setLoading(true);
    try {
      const user = await signIn(credentials.username.trim(), credentials.password);
      setOperator(user?.user || user || null);
      setLoggedIn(true);
    } catch (error) {
      setMessage(error.message || '登录失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadOrders(page = pagination.page) {
    if (dateRangeInvalid) {
      setMessage('结束日期不能早于开始日期');
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      const result = await listOrders({
        ...filters,
        page,
        pageSize: pagination.pageSize
      });
      setOrders(result.items || []);
      setNotebookTypes(result.notebook_types || []);
      setPagination((current) => ({ ...current, page, total: result.total || 0 }));
      setSelectedIds([]);
    } catch (error) {
      setMessage(error.message || '订单加载失败');
    } finally {
      setLoading(false);
    }
  }

  function toggleOrder(orderId) {
    setSelectedIds((current) => (
      current.includes(orderId)
        ? current.filter((id) => id !== orderId)
        : [...current, orderId]
    ));
  }

  function toggleAll() {
    const pageIds = orders.map((order) => order.order_id);
    const allSelected = pageIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected
      ? selectedIds.filter((id) => !pageIds.includes(id))
      : [...new Set([...selectedIds, ...pageIds])]);
  }

  function resetFilters() {
    setFilters({ ...EMPTY_FILTERS });
    setSelectedIds([]);
    setMessage('');
  }

  function openImagePreview(order, side) {
    const url = order[side + '_url'];
    if (!url) return;
    setImagePreviewSize(null);
    setImagePreview({
      url,
      title: `${order.order_id} · ${side === 'front' ? '前图' : '后图'}`
    });
  }

  function handlePreviewImageLoad(event) {
    const image = event.currentTarget;
    const maxWidth = Math.max(240, window.innerWidth - 64);
    const maxHeight = Math.max(240, window.innerHeight - 150);
    const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    setImagePreviewSize({
      width: Math.round(image.naturalWidth * scale),
      height: Math.round(image.naturalHeight * scale)
    });
  }

  async function handleBatchDownload() {
    if (selectedIds.length === 0) {
      setMessage('请先选择订单');
      return;
    }

    setLoading(true);
    setMessage('正在生成下载包...');
    try {
      const result = await batchDownload(selectedIds);
      window.location.href = result.download_url;
      setMessage('下载包已生成，链接 15 分钟内有效');
    } catch (error) {
      setMessage(error.message || '批量下载失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await signOut();
    } finally {
      setLoggedIn(false);
      setOperator(null);
      setSelectedIds([]);
      setView('orders');
    }
  }

  async function openAccountView() {
    setView('accounts');
    setAccountMessage('');
    if (operator?.role !== 'admin') return;
    setAccountLoading(true);
    try {
      setAccounts(await listAccounts());
    } catch (error) {
      setAccountMessage(error.message || '账号列表加载失败');
    } finally {
      setAccountLoading(false);
    }
  }

  async function handleSelfPasswordChange() {
    setAccountMessage('');
    try {
      await updateAccount('me', { password: selfPassword });
      setSelfPassword('');
      setAccountMessage('我的密码已修改');
    } catch (error) {
      setAccountMessage(error.message || '密码修改失败');
    }
  }

  async function handleCreateAccount(event) {
    event.preventDefault();
    setAccountLoading(true);
    setAccountMessage('');
    try {
      await createAccount(accountForm);
      setAccountForm({ username: '', password: '', role: 'operator' });
      setAccounts(await listAccounts());
      setAccountMessage('账号已创建');
    } catch (error) {
      setAccountMessage(error.message || '账号创建失败');
    } finally {
      setAccountLoading(false);
    }
  }

  async function handleAccountPassword(accountId) {
    const password = accountPasswordDrafts[accountId] || '';
    setAccountLoading(true);
    setAccountMessage('');
    try {
      await updateAccount(accountId, { password });
      setAccountPasswordDrafts({ ...accountPasswordDrafts, [accountId]: '' });
      setAccountMessage('账号密码已修改');
    } catch (error) {
      setAccountMessage(error.message || '账号密码修改失败');
    } finally {
      setAccountLoading(false);
    }
  }

  async function handleAccountDisabled(account) {
    setAccountLoading(true);
    setAccountMessage('');
    try {
      await updateAccount(account.id, { disabled: !account.disabled });
      setAccounts(await listAccounts());
      setAccountMessage(account.disabled ? '账号已启用' : '账号已禁用');
    } catch (error) {
      setAccountMessage(error.message || '账号状态修改失败');
    } finally {
      setAccountLoading(false);
    }
  }

  if (sessionLoading) {
    return (
      <main className="login-shell">
        <div className="login-card loading-card">
          <p className="eyebrow">NOTEBOOK OPERATIONS</p>
          <h1>正在检查登录状态</h1>
          <p className="muted">请稍候...</p>
        </div>
      </main>
    );
  }

  if (!loggedIn) {
    return (
      <main className="login-shell">
        <form className="login-card" onSubmit={handleLogin}>
          <p className="eyebrow">NOTEBOOK OPERATIONS</p>
          <h1>运维后台</h1>
          <p className="muted">登录后管理订单和打印文件</p>
          <label>
            账号 ID
            <input
              value={credentials.username}
              onChange={(event) => setCredentials({ ...credentials, username: event.target.value })}
              autoComplete="username"
              required
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={credentials.password}
              onChange={(event) => setCredentials({ ...credentials, password: event.target.value })}
              autoComplete="current-password"
              required
            />
          </label>
          <button className="primary-button" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </button>
          {message && <p className="error-text">{message}</p>}
        </form>
      </main>
    );
  }

  const totalPages = Math.max(Math.ceil(pagination.total / pagination.pageSize), 1);
  const currentPage = pagination.page;
  const notebookTypeKeyword = filters.notebook_type.trim().toLowerCase();
  const visibleNotebookTypes = notebookTypes.filter((item) => (
    !notebookTypeKeyword
    || item.display_name.toLowerCase().includes(notebookTypeKeyword)
  ));

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">NOTEBOOK OPERATIONS</p>
          <h1>打印订单</h1>
        </div>
        <div className="account-actions">
          <span className="operator-name">{operator?.username || '运营人员'}</span>
          <button className="text-button" onClick={handleLogout}>退出登录</button>
        </div>
      </header>

      <nav className="view-tabs" aria-label="后台功能">
        <button
          className={view === 'orders' ? 'active' : ''}
          onClick={() => setView('orders')}
        >
          订单管理
        </button>
        <button
          className={view === 'accounts' ? 'active' : ''}
          onClick={openAccountView}
        >
          账号管理
        </button>
      </nav>

      {view === 'accounts' ? (
        <section className="accounts-layout">
          <div className="account-panel">
            <p className="eyebrow">ACCOUNT SECURITY</p>
            <h2>修改我的密码</h2>
            <p className="muted">当前账号：{operator?.username}</p>
            <label>
              新密码
              <input
                type="password"
                value={selfPassword}
                onChange={(event) => setSelfPassword(event.target.value)}
                placeholder="请输入新密码"
              />
            </label>
            <button
              className="primary-button"
              onClick={handleSelfPasswordChange}
              disabled={accountLoading || !selfPassword}
            >
              修改我的密码
            </button>
          </div>

          {operator?.role === 'admin' && (
            <div className="account-panel account-admin-panel">
              <div className="account-panel-heading">
                <div>
                  <p className="eyebrow">STAFF ACCOUNTS</p>
                  <h2>用户管理</h2>
                </div>
                <span className="muted">管理员</span>
              </div>
              <form className="account-create-form" onSubmit={handleCreateAccount}>
                <label>
                  账号 ID
                  <input
                    value={accountForm.username}
                    onChange={(event) => setAccountForm({ ...accountForm, username: event.target.value })}
                    placeholder="例如 printer01"
                    required
                  />
                </label>
                <label>
                  初始密码
                  <input
                    type="password"
                    value={accountForm.password}
                    onChange={(event) => setAccountForm({ ...accountForm, password: event.target.value })}
                    required
                  />
                </label>
                <label>
                  角色
                  <select
                    value={accountForm.role}
                    onChange={(event) => setAccountForm({ ...accountForm, role: event.target.value })}
                  >
                    <option value="operator">普通用户</option>
                    <option value="admin">管理员</option>
                  </select>
                </label>
                <button className="primary-button" disabled={accountLoading}>增加账号</button>
              </form>
              <div className="account-list-heading">
                <strong>已有账号</strong>
                <span>{accountLoading && accounts.length > 0 ? '正在刷新…' : `共 ${accounts.length} 个`}</span>
              </div>
              <div className="account-list">
                {accountLoading && accounts.length === 0 && <p className="muted">正在加载账号...</p>}
                {!accountLoading && accounts.length === 0 && <p className="muted">暂无账号</p>}
                {accounts.map((account) => (
                  <div className="account-row" key={account.id}>
                    <div className="account-summary">
                      <strong>{account.username}</strong>
                      <span className="account-role">{account.role === 'admin' ? '管理员' : '普通用户'}</span>
                      {account.disabled && <span className="account-disabled">已禁用</span>}
                    </div>
                    <div className="account-actions-row">
                      <input
                        type="password"
                        value={accountPasswordDrafts[account.id] || ''}
                        onChange={(event) => setAccountPasswordDrafts({
                          ...accountPasswordDrafts,
                          [account.id]: event.target.value
                        })}
                        placeholder="设置新密码"
                      />
                      <button
                        className="secondary-button"
                        onClick={() => handleAccountPassword(account.id)}
                        disabled={accountLoading || !accountPasswordDrafts[account.id]}
                      >
                        改密码
                      </button>
                      <button
                        className="text-button"
                        onClick={() => handleAccountDisabled(account)}
                        disabled={accountLoading || account.id === operator?.id}
                      >
                        {account.disabled ? '启用' : '禁用'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {accountMessage && <p className="status-text account-message">{accountMessage}</p>}
        </section>
      ) : (
      <>
      <section className="filter-card">
        <div className="filter-grid">
          {/* 平台、店铺、商品名暂时不展示；后端字段保留，后续需要时再恢复。 */}
          <label>
            订单号
            <input
              value={filters.order_id}
              onChange={(event) => setFilters({ ...filters, order_id: event.target.value })}
              placeholder="搜索订单号"
            />
          </label>
          <label className="combobox-field">
            本册类型
            <div
              className="combobox"
              onBlur={() => window.setTimeout(() => setNotebookTypeOpen(false), 120)}
            >
              <input
                value={filters.notebook_type}
                onFocus={() => setNotebookTypeOpen(true)}
                onClick={() => setNotebookTypeOpen(true)}
                onChange={(event) => {
                  setFilters({ ...filters, notebook_type: event.target.value });
                  setNotebookTypeOpen(true);
                }}
                placeholder="输入关键词或选择类型"
                autoComplete="off"
                aria-expanded={notebookTypeOpen}
              />
              {notebookTypeOpen && (
                <div className="combobox-menu" role="listbox">
                  {visibleNotebookTypes.length > 0 ? visibleNotebookTypes.map((item) => (
                    <button
                      type="button"
                      className="combobox-option"
                      key={item.slug}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setFilters({ ...filters, notebook_type: item.display_name });
                        setNotebookTypeOpen(false);
                      }}
                    >
                      <span>{item.display_name}</span>
                    </button>
                  )) : <div className="combobox-empty">没有匹配的本册类型</div>}
                </div>
              )}
            </div>
          </label>
          {/* 平台、店铺、商品名暂时不展示；后端字段保留，后续需要时再恢复。 */}
          <label>
            状态
            <select
              value={filters.status}
              onChange={(event) => setFilters({ ...filters, status: event.target.value })}
            >
              <option value="">全部</option>
              <option value="draft">未提交</option>
              <option value="submitted">已提交</option>
              <option value="pending">待处理</option>
              <option value="completed">已完成</option>
            </select>
          </label>
          <label>
            开始日期
            <input
              type="date"
              value={filters.created_from}
              max={filters.created_to || undefined}
              onChange={(event) => setFilters({ ...filters, created_from: event.target.value })}
              aria-invalid={dateRangeInvalid}
            />
          </label>
          <label>
            结束日期
            <input
              type="date"
              value={filters.created_to}
              min={filters.created_from || undefined}
              onChange={(event) => setFilters({ ...filters, created_to: event.target.value })}
              aria-invalid={dateRangeInvalid}
            />
          </label>
        </div>
        <div className="toolbar">
          <button className="primary-button" onClick={() => loadOrders(1)} disabled={loading || dateRangeInvalid}>
            {loading ? '处理中...' : '查询'}
          </button>
          <button className="secondary-button" onClick={resetFilters} disabled={loading}>
            清空条件
          </button>
          <button className="secondary-button" onClick={handleBatchDownload} disabled={loading || selectedIds.length === 0}>
            批量下载 ({selectedIds.length})
          </button>
          {dateRangeInvalid
            ? <span className="error-text">结束日期不能早于开始日期</span>
            : message && <span className="status-text">{message}</span>}
        </div>
      </section>

      <section className="table-card">
        <table>
          <thead>
              <tr>
                <th><input type="checkbox" onChange={toggleAll} checked={orders.length > 0 && orders.every((order) => selectedIds.includes(order.order_id))} /></th>
                <th>订单号</th>
                <th>订单平台</th>
                <th>本册类型</th>
              <th>状态</th>
              <th>图片</th>
              <th>上传/修改时间</th>
            </tr>
          </thead>
          <tbody>
              {orders.map((order) => (
                <tr key={order.order_id}>
                <td><input type="checkbox" checked={selectedIds.includes(order.order_id)} onChange={() => toggleOrder(order.order_id)} /></td>
                  <td className="strong">{order.order_id}</td>
                  <td>{order.platform_display || order.platform || detectPlatform(order.order_id) || '未知平台'}</td>
                  <td>{order.display_name || order.notebook_type}</td>
                <td><span className={`status-pill ${order.status}`}>{order.status === 'submitted' ? '已提交' : order.status === 'completed' ? '已完成' : order.status === 'draft' ? '未提交' : '待处理'}</span></td>
                <td>
                  <div className="order-image-cell">
                    {order.front_url && (
                      <button className="image-thumb-button" onClick={() => openImagePreview(order, 'front')} aria-label={`${order.order_id} 前图`}>
                        <img src={order.front_url} alt="前图" />
                      </button>
                    )}
                    {order.back_url && (
                      <button className="image-thumb-button" onClick={() => openImagePreview(order, 'back')} aria-label={`${order.order_id} 后图`}>
                        <img src={order.back_url} alt="后图" />
                      </button>
                    )}
                    {!order.front_url && !order.back_url && <span className="image-empty">无图片</span>}
                  </div>
                </td>
                <td className="time-cell">
                  <div><span>上传</span>{formatRelativeTime(getOrderUploadTime(order))}</div>
                  <div><span>修改</span>{formatRelativeTime(getOrderUpdatedTime(order))}</div>
                </td>
              </tr>
            ))}
            {orders.length === 0 && <tr><td colSpan="6" className="empty-cell">暂无订单</td></tr>}
          </tbody>
        </table>
        <div className="pagination">
          <span>共 {pagination.total} 条</span>
          <button disabled={currentPage <= 1 || loading} onClick={() => loadOrders(currentPage - 1)}>上一页</button>
          <span>{currentPage} / {totalPages}</span>
          <button disabled={currentPage >= totalPages || loading} onClick={() => loadOrders(currentPage + 1)}>下一页</button>
        </div>
      </section>
      {imagePreview && (
        <div className="image-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setImagePreview(null);
        }}>
          <section
            className="image-modal"
            role="dialog"
            aria-modal="true"
            aria-label="订单图片预览"
            style={imagePreviewSize ? { width: `${imagePreviewSize.width + 32}px` } : undefined}
          >
            <div className="image-modal-heading">
              <strong>{imagePreview.title}</strong>
              <button className="text-button" onClick={() => setImagePreview(null)}>关闭</button>
            </div>
            <img
              src={imagePreview.url}
              alt={imagePreview.title}
              onLoad={handlePreviewImageLoad}
              style={imagePreviewSize ? {
                width: `${imagePreviewSize.width}px`,
                height: `${imagePreviewSize.height}px`
              } : undefined}
            />
          </section>
        </div>
      )}
      </>
      )}
    </main>
  );
}
