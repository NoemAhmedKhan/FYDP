// ============================
// SUPABASE CLIENT
// ============================
const { createClient } = window.supabase;
const sb = createClient(
    'https://ktzsshlllyjuzphprzso.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic'
);

// ============================
// STATE
// ============================
let currentUser          = null;
let allTables            = [];
let currentTable         = null;
let currentPage          = 1;
const PAGE_SIZE          = 20;
let totalRows            = 0;
let currentTableColumns  = [];
let pendingDeleteId      = null;
let pendingEditId        = null;
let pendingRejectId      = null;
let pendingRejectEmail   = null;
let pendingRejectName    = null;

// ============================
// INIT
// ============================
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
        window.location.href = 'AdminLogin.html';
        return;
    }

    currentUser = session.user;
    setUserInfo(currentUser);

    await Promise.all([loadTables(), loadOverviewStats()]);
    hideLoading();
});

function setUserInfo(user) {
    const email   = user.email || '';
    const name    = user.user_metadata?.full_name || email.split('@')[0] || 'Admin';
    const initial = name.charAt(0).toUpperCase();

    document.getElementById('admin-name').textContent    = name;
    document.getElementById('admin-email').textContent   = email;
    document.getElementById('admin-avatar').textContent  = initial;
    document.getElementById('topbar-avatar').textContent = initial;
    document.getElementById('topbar-name').textContent   = name;
}

function hideLoading() {
    const ls = document.getElementById('loading-screen');
    ls.classList.add('hidden');
    setTimeout(() => ls.remove(), 500);
}

// ============================
// SIDEBAR TOGGLE
// ============================
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('open');
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
}

// ============================
// NAVIGATION
// ============================
function setActiveNav(id) {
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    closeSidebar();
}

function showOverview() {
    showView('view-overview');
    setActiveNav('nav-overview');
    document.getElementById('breadcrumb').innerHTML = '<i class="fa-solid fa-gauge-high"></i> Dashboard';
    loadOverviewStats();
}

async function showPharmacyRequests() {
    showView('view-requests');
    setActiveNav('nav-requests');
    document.getElementById('breadcrumb').innerHTML = '<i class="fa-solid fa-store"></i> Pharmacy Requests';
    await loadPharmacyRequests();
}

// ============================
// LOAD TABLES (sidebar list)
// ============================
async function loadTables() {
    try {
        const { data, error } = await sb
            .from('information_schema.tables')
            .select('table_name')
            .eq('table_schema', 'public')
            .eq('table_type', 'BASE TABLE')
            .order('table_name');

        if (error) throw error;

        allTables = (data || [])
            .map(r => r.table_name)
            .filter(t => !['schema_migrations', 'spatial_ref_sys'].includes(t));

        document.getElementById('stat-tables').textContent = allTables.length;
        renderTableList();
    } catch {
        await loadTablesFallback();
    }
}

async function loadTablesFallback() {
    try {
        const { data, error } = await sb.rpc('get_tables');
        if (error || !data) {
            document.getElementById('table-list').innerHTML = '<div class="sidebar-loading">No tables found</div>';
            return;
        }
        allTables = data;
        renderTableList();
    } catch {
        document.getElementById('table-list').innerHTML =
            '<div class="sidebar-loading" style="color:#ef4444"><i class="fa-solid fa-circle-exclamation"></i> Failed to load tables</div>';
    }
}

function renderTableList() {
    const list = document.getElementById('table-list');
    if (!allTables.length) {
        list.innerHTML = '<div class="sidebar-loading">No tables found</div>';
        return;
    }
    list.innerHTML = allTables.map(t => `
        <a class="sidebar-link" id="nav-table-${t}" onclick="loadTableView('${t}')">
            <i class="fa-solid fa-table"></i>
            <span>${formatTableName(t)}</span>
        </a>
    `).join('');
}

function formatTableName(name) {
    return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ============================
// TABLE VIEW
// ============================
async function loadTableView(tableName) {
    currentTable = tableName;
    currentPage  = 1;
    showView('view-table');
    setActiveNav(`nav-table-${tableName}`);

    const formatted = formatTableName(tableName);
    document.getElementById('table-view-title').innerHTML    = `<i class="fa-solid fa-table"></i> ${formatted}`;
    document.getElementById('table-view-subtitle').textContent = `Manage records in "${tableName}"`;
    document.getElementById('breadcrumb').innerHTML           = `<i class="fa-solid fa-table"></i> ${formatted}`;

    await fetchTableData();
}

async function fetchTableData() {
    const wrapper = document.getElementById('table-wrapper');
    wrapper.innerHTML = '<div class="loading-indicator"><div class="spinner"></div> Loading data...</div>';
    document.getElementById('pagination').innerHTML = '';

    try {
        const from = (currentPage - 1) * PAGE_SIZE;
        const to   = from + PAGE_SIZE - 1;

        const { data, error, count } = await sb
            .from(currentTable)
            .select('*', { count: 'exact' })
            .range(from, to);

        if (error) throw error;

        totalRows = count || 0;
        document.getElementById('table-row-count').textContent = `${totalRows} record${totalRows !== 1 ? 's' : ''} total`;

        if (!data || data.length === 0) {
            wrapper.innerHTML = '<div class="empty-state"><i class="fa-solid fa-table"></i><p>No records in this table</p></div>';
            return;
        }

        currentTableColumns = Object.keys(data[0]);
        renderTable(data);
        renderPagination();
    } catch (e) {
        wrapper.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i><p>Error: ${e.message}</p></div>`;
    }
}

function renderTable(rows) {
    const cols  = currentTableColumns;
    const thead = `<thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}<th>Actions</th></tr></thead>`;
    const tbody = `<tbody>${rows.map(row => `
        <tr>
            ${cols.map(c => {
                const v = row[c];
                // Render URL columns as clickable links
                if (typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))) {
                    return `<td><a href="${v}" target="_blank" style="color:var(--green);font-size:12px;" title="${v}">View Doc</a></td>`;
                }
                if (Array.isArray(v)) {
                    return `<td title="${v.join(', ')}">${v.map((u, i) => `<a href="${u}" target="_blank" style="color:var(--green);font-size:12px;">Doc ${i+1}</a>`).join(' ')}</td>`;
                }
                return `<td title="${v ?? ''}">${v !== null && v !== undefined ? String(v).substring(0, 80) : '<span class="null-badge">null</span>'}</td>`;
            }).join('')}
            <td>
                <div class="action-btns">
                    <button class="btn-edit" onclick='openEditModal(${JSON.stringify(row)})'>
                        <i class="fa-solid fa-pen"></i> Edit
                    </button>
                    <button class="btn-delete" onclick="openDeleteModal('${getPrimaryKey(row)}')">
                        <i class="fa-solid fa-trash"></i> Delete
                    </button>
                </div>
            </td>
        </tr>
    `).join('')}</tbody>`;

    document.getElementById('table-wrapper').innerHTML = `<table>${thead}${tbody}</table>`;
}

function getPrimaryKey(row) {
    return row.id !== undefined ? row.id : row[Object.keys(row)[0]];
}

function renderPagination() {
    const totalPages = Math.ceil(totalRows / PAGE_SIZE);
    if (totalPages <= 1) return;

    let html = `<button class="page-btn" onclick="gotoPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`;

    let start = Math.max(1, currentPage - 2);
    let end   = Math.min(totalPages, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);

    for (let i = start; i <= end; i++) {
        html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="gotoPage(${i})">${i}</button>`;
    }
    html += `<button class="page-btn" onclick="gotoPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>`;

    document.getElementById('pagination').innerHTML = html;
}

function gotoPage(page) {
    const totalPages = Math.ceil(totalRows / PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    fetchTableData();
}

function refreshTable() {
    if (currentTable) fetchTableData();
}

// ============================
// OVERVIEW STATS
// ============================
async function loadOverviewStats() {
    try {
        const { count } = await sb.from('pharmacies').select('*', { count: 'exact', head: true });
        document.getElementById('stat-pharmacies').textContent = count ?? '—';
    } catch { document.getElementById('stat-pharmacies').textContent = '—'; }

    try {
        const { count } = await sb.from('pharmacy_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending');
        document.getElementById('request-badge').textContent = count > 0 ? count : '';
        document.getElementById('stat-pending').textContent  = count ?? '—';
    } catch { document.getElementById('stat-pending').textContent = '—'; }

    try {
        const { count } = await sb.from('users').select('*', { count: 'exact', head: true });
        document.getElementById('stat-users').textContent = count ?? '—';
    } catch { document.getElementById('stat-users').textContent = '—'; }

    document.getElementById('stat-tables').textContent = allTables.length || '—';

    await loadRecentRequests();
}

async function loadRecentRequests() {
    const container = document.getElementById('recent-requests-list');
    try {
        const { data, error } = await sb
            .from('pharmacy_requests')
            .select('id, pharmacy_name, email, city, created_at')
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(5);

        if (error || !data || data.length === 0) {
            container.innerHTML = '<div class="empty-state-sm"><i class="fa-solid fa-check-circle" style="color:var(--green)"></i> No pending requests</div>';
            return;
        }

        container.innerHTML = data.map(r => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-bottom:1px solid #f0f0f0;">
                <div>
                    <div style="font-size:13px;font-weight:500;color:var(--dark)">${r.pharmacy_name || 'Unnamed'}</div>
                    <div style="font-size:11px;color:var(--gray)">${r.email || ''} • ${r.city || ''}</div>
                </div>
                <span style="font-size:10px;background:#fef3c7;color:#d97706;padding:2px 8px;border-radius:10px;border:1px solid #fde68a;white-space:nowrap">Pending</span>
            </div>
        `).join('');
    } catch {
        container.innerHTML = '<div class="empty-state-sm">Could not load requests</div>';
    }
}

// ============================
// PHARMACY REQUESTS
// ============================
async function loadPharmacyRequests() {
    const container = document.getElementById('requests-container');
    container.innerHTML = '<div class="loading-indicator"><div class="spinner"></div> Loading pharmacy requests...</div>';

    try {
        const { data, error } = await sb
            .from('pharmacy_requests')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: false });

        if (error) throw error;

        const badge = document.getElementById('request-badge');
        badge.textContent = data && data.length > 0 ? data.length : '';

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-check-circle"></i><p>No pending pharmacy requests. All caught up!</p></div>';
            return;
        }

        container.innerHTML = `<div class="request-cards">${data.map(r => renderRequestCard(r)).join('')}</div>`;
    } catch (e) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-circle-exclamation" style="color:#ef4444"></i>
                <p>Error loading requests: ${e.message}</p>
                <p style="font-size:12px;margin-top:8px">Make sure the "pharmacy_requests" table exists with the correct schema.</p>
            </div>`;
    }
}

function renderRequestCard(r) {
    // Fields to show in card (exclude system/doc fields rendered separately)
    const skipInCard  = ['id', 'status', 'created_at', 'updated_at', 'rejection_reason',
                         'license_doc_url', 'cnic_doc_url', 'extra_doc_urls'];
    const displayFields = Object.entries(r)
        .filter(([k]) => !skipInCard.includes(k))
        .map(([k, v]) => `
            <div class="request-field">
                <div class="request-field-label">${k.replace(/_/g, ' ')}</div>
                <div class="request-field-value">${v !== null && v !== undefined ? String(v) : '<span class="null-badge">—</span>'}</div>
            </div>
        `).join('');

    // Build document links
    const docLinks = [];
    if (r.license_doc_url) docLinks.push(`<a href="${r.license_doc_url}" target="_blank" class="doc-link"><i class="fa-solid fa-file-medical"></i> Drug License</a>`);
    if (r.cnic_doc_url)    docLinks.push(`<a href="${r.cnic_doc_url}"    target="_blank" class="doc-link"><i class="fa-solid fa-id-card"></i> CNIC</a>`);
    if (Array.isArray(r.extra_doc_urls)) {
        r.extra_doc_urls.forEach((u, i) => {
            docLinks.push(`<a href="${u}" target="_blank" class="doc-link"><i class="fa-solid fa-file"></i> Extra Doc ${i + 1}</a>`);
        });
    }

    const docsHtml = docLinks.length > 0
        ? `<div class="request-docs"><span class="docs-label"><i class="fa-solid fa-paperclip"></i> Documents:</span>${docLinks.join('')}</div>`
        : '<div class="request-docs"><span class="docs-label" style="color:#aaa">No documents uploaded</span></div>';

    const name    = r.pharmacy_name || `Request #${r.id}`;
    const created = r.created_at ? new Date(r.created_at).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

    // Escape for inline onclick attributes
    const safeEmail = (r.email || '').replace(/'/g, "\\'");
    const safeName  = name.replace(/'/g, "\\'");

    return `
        <div class="request-card" id="req-card-${r.id}">
            <div class="request-card-header">
                <div class="request-pharmacy-name">
                    <i class="fa-solid fa-store"></i>
                    ${name}
                    ${created ? `<span style="font-size:11px;font-weight:400;color:var(--gray)">• ${created}</span>` : ''}
                </div>
                <span class="request-status-badge">Pending</span>
            </div>
            <div class="request-body">
                <div class="request-fields">${displayFields}</div>
                ${docsHtml}
                <div class="request-actions">
                    <button class="btn-approve" onclick="approveRequest('${r.id}', this)">
                        <i class="fa-solid fa-check"></i> Approve
                    </button>
                    <button class="btn-reject" onclick="openRejectModal('${r.id}', '${safeEmail}', '${safeName}')">
                        <i class="fa-solid fa-times"></i> Reject
                    </button>
                </div>
            </div>
        </div>
    `;
}

// ============================
// APPROVE REQUEST
// ============================
async function approveRequest(requestId, btn) {
    btn.disabled  = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.4);border-top-color:white"></div> Approving...';

    try {
        // 1. Fetch the full request
        const { data: req, error: fetchErr } = await sb
            .from('pharmacy_requests')
            .select('*')
            .eq('id', requestId)
            .single();
        if (fetchErr) throw fetchErr;

        // 2. Build pharmacy record — strip request-only fields
        const { id, status, created_at, updated_at, rejection_reason, ...pharmacyData } = req;

        // 3. Insert into pharmacies
        const { error: insertErr } = await sb
            .from('pharmacies')
            .insert([{ ...pharmacyData, approved_at: new Date().toISOString(), status: 'active' }]);
        if (insertErr) throw insertErr;

        // 4. Delete from pharmacy_requests
        const { error: deleteErr } = await sb
            .from('pharmacy_requests')
            .delete()
            .eq('id', requestId);
        if (deleteErr) throw deleteErr;

        // 5. Send approval email (non-blocking)
        sendEmail({
            to:           req.email,
            type:         'approval',
            pharmacyName: req.pharmacy_name
        }).catch(err => console.warn('Approval email failed (non-critical):', err));

        // 6. Animate card out
        animateCardOut(`req-card-${requestId}`, 'right');
        showToast(`${req.pharmacy_name} approved and added to pharmacies!`, 'success');
        await updatePendingBadge();

    } catch (e) {
        showToast(`Approval error: ${e.message}`, 'error');
        btn.disabled  = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Approve';
    }
}

// ============================
// REJECT REQUEST
// ============================
function openRejectModal(requestId, email, pharmacyName) {
    pendingRejectId    = requestId;
    pendingRejectEmail = email;
    pendingRejectName  = pharmacyName;
    document.getElementById('reject-pharmacy-name').value = pharmacyName;
    document.getElementById('reject-reason').value        = '';
    openModal('reject-modal');
}

async function confirmReject() {
    const reason = document.getElementById('reject-reason').value.trim();
    if (!reason) {
        showToast('Please enter a rejection reason.', 'error');
        return;
    }

    const btn = document.querySelector('#reject-modal .btn-modal-danger');
    btn.disabled  = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.4);border-top-color:white"></div> Processing...';

    try {
        // 1. Send rejection email (non-blocking, fire first)
        sendEmail({
            to:           pendingRejectEmail,
            type:         'rejection',
            pharmacyName: pendingRejectName,
            reason
        }).catch(err => console.warn('Rejection email failed (non-critical):', err));

        // 2. Delete from pharmacy_requests
        const { error } = await sb
            .from('pharmacy_requests')
            .delete()
            .eq('id', pendingRejectId);
        if (error) throw error;

        // 3. Animate card out
        animateCardOut(`req-card-${pendingRejectId}`, 'left');
        closeModal('reject-modal');
        showToast('Request rejected and pharmacy notified.', 'success');
        await updatePendingBadge();

    } catch (e) {
        showToast(`Reject error: ${e.message}`, 'error');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fa-solid fa-times"></i> Confirm Rejection';
    }
}

// ============================
// EMAIL HELPER
// ============================
async function sendEmail({ to, type, pharmacyName, reason }) {
    const subjects = {
        approval:  'MediFinder — Your Pharmacy Registration is Approved! 🎉',
        rejection: 'MediFinder — Pharmacy Registration Update'
    };
    return sb.functions.invoke('send-email', {
        body: { to, subject: subjects[type], type, pharmacyName, reason }
    });
}

// ============================
// CARD ANIMATION HELPER
// ============================
function animateCardOut(cardId, direction = 'right') {
    const card = document.getElementById(cardId);
    if (!card) return;
    const tx = direction === 'right' ? '30px' : '-30px';
    card.style.transition = 'all 0.4s ease';
    card.style.opacity    = '0';
    card.style.transform  = `translateX(${tx})`;
    setTimeout(() => {
        card.remove();
        // If no cards left, show empty state
        const remaining = document.querySelectorAll('.request-card');
        if (remaining.length === 0) {
            document.getElementById('requests-container').innerHTML =
                '<div class="empty-state"><i class="fa-solid fa-check-circle"></i><p>No pending pharmacy requests. All caught up!</p></div>';
        }
    }, 400);
}

async function updatePendingBadge() {
    try {
        const { count } = await sb.from('pharmacy_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending');
        document.getElementById('request-badge').textContent = count > 0 ? count : '';
        document.getElementById('stat-pending').textContent  = count ?? '0';
    } catch {}
}

// ============================
// DELETE ROW
// ============================
function openDeleteModal(rowId) {
    pendingDeleteId = rowId;
    openModal('delete-modal');
}

async function confirmDelete() {
    const btn = document.querySelector('#delete-modal .btn-modal-danger');
    btn.disabled  = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.4);border-top-color:white"></div> Deleting...';

    try {
        const pkColumn = currentTableColumns.includes('id') ? 'id' : currentTableColumns[0];
        const { error } = await sb.from(currentTable).delete().eq(pkColumn, pendingDeleteId);
        if (error) throw error;

        closeModal('delete-modal');
        showToast('Record deleted successfully.', 'success');
        await fetchTableData();
    } catch (e) {
        showToast(`Delete failed: ${e.message}`, 'error');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
    }
}

// ============================
// EDIT ROW
// ============================
function openEditModal(row) {
    const pkColumn = 'id' in row ? 'id' : Object.keys(row)[0];
    pendingEditId  = row[pkColumn];

    const skip   = ['id', 'created_at', 'approved_at'];
    const fields = Object.entries(row)
        .filter(([k]) => !skip.includes(k))
        .map(([k, v]) => {
            // Render arrays as comma-separated for easy editing
            const val = Array.isArray(v) ? (v || []).join(', ') : (v !== null && v !== undefined ? String(v) : '');
            return `
                <div class="form-group">
                    <label>${k.replace(/_/g, ' ')}</label>
                    <input type="text" class="modal-input" id="edit-field-${k}" name="${k}" value="${val.replace(/"/g, '&quot;')}">
                </div>`;
        }).join('');

    document.getElementById('edit-modal-body').innerHTML = `<div class="modal-fields-grid">${fields}</div>`;
    openModal('edit-modal');
}

async function confirmEdit() {
    const btn = document.querySelector('#edit-modal .btn-modal-primary');
    btn.disabled  = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.4);border-top-color:white"></div> Saving...';

    try {
        const inputs  = document.querySelectorAll('#edit-modal-body input');
        const updates = {};
        inputs.forEach(inp => {
            updates[inp.name] = inp.value === '' ? null : inp.value;
        });

        const pkColumn = currentTableColumns.includes('id') ? 'id' : currentTableColumns[0];
        const { error } = await sb.from(currentTable).update(updates).eq(pkColumn, pendingEditId);
        if (error) throw error;

        closeModal('edit-modal');
        showToast('Record updated successfully.', 'success');
        await fetchTableData();
    } catch (e) {
        showToast(`Update failed: ${e.message}`, 'error');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fa-solid fa-save"></i> Save Changes';
    }
}

// ============================
// ADD ROW
// ============================
function showAddRowModal() {
    if (!currentTableColumns.length) return;
    const skip   = ['id', 'created_at', 'updated_at', 'approved_at'];
    const fields = currentTableColumns
        .filter(c => !skip.includes(c))
        .map(c => `
            <div class="form-group">
                <label>${c.replace(/_/g, ' ')}</label>
                <input type="text" class="modal-input" id="add-field-${c}" name="${c}" placeholder="Enter ${c}">
            </div>`).join('');

    document.getElementById('add-modal-body').innerHTML = `<div class="modal-fields-grid">${fields}</div>`;
    openModal('add-modal');
}

async function confirmAdd() {
    const btn = document.querySelector('#add-modal .btn-modal-primary');
    btn.disabled  = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.4);border-top-color:white"></div> Adding...';

    try {
        const inputs = document.querySelectorAll('#add-modal-body input');
        const newRow = {};
        inputs.forEach(inp => { if (inp.value !== '') newRow[inp.name] = inp.value; });

        const { error } = await sb.from(currentTable).insert([newRow]);
        if (error) throw error;

        closeModal('add-modal');
        showToast('Row added successfully.', 'success');
        await fetchTableData();
    } catch (e) {
        showToast(`Insert failed: ${e.message}`, 'error');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Row';
    }
}

// ============================
// MODAL HELPERS
// ============================
function openModal(id) {
    document.getElementById(id).classList.add('open');
    document.body.style.overflow = 'hidden';
}
function closeModal(id) {
    document.getElementById(id).classList.remove('open');
    document.body.style.overflow = '';
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        ['reject-modal', 'delete-modal', 'edit-modal', 'add-modal'].forEach(closeModal);
    }
});

// ============================
// TOAST NOTIFICATIONS
// ============================
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const icons     = { success: 'fa-circle-check', error: 'fa-circle-exclamation', warning: 'fa-triangle-exclamation' };

    const toast     = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.success}"></i><span>${message}</span>`;
    toast.onclick   = () => toast.remove();
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ============================
// LOGOUT
// ============================
async function handleLogout() {
    await sb.auth.signOut();
    window.location.href = 'AdminLogin.html';
}
