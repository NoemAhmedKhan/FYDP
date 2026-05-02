// ============================================================
//  AdminDashboard.js — MediFinder
//  Approval flow now calls the approve-pharmacy Edge Function
//  which creates the auth account server-side (secure).
// ============================================================

// ── Supabase Client (anon key — for reading data only) ──────
const { createClient } = window.supabase;
const sb = createClient(
    'https://ktzsshlllyjuzphprzso.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic'
);

// ── State ────────────────────────────────────────────────────
let currentUser         = null;
let allTables           = [];
let currentTable        = null;
let currentPage         = 1;
const PAGE_SIZE         = 20;
let totalRows           = 0;
let currentTableColumns = [];
let pendingDeleteId     = null;
let pendingEditId       = null;
let pendingRejectId     = null;
let pendingRejectEmail  = null;
let pendingRejectName   = null;
let pendingRejectFolder = null;   // doc_folder_path for storage cleanup on reject

// ============================================================
//  INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.href = 'Login.html'; return; }

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
}

function hideLoading() {
    const ls = document.getElementById('loading-screen');
    ls.classList.add('hidden');
    setTimeout(() => ls.remove(), 500);
}

// ============================================================
//  SIDEBAR
// ============================================================
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('open');
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
}

// ============================================================
//  NAVIGATION
// ============================================================
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

// ============================================================
//  SIDEBAR TABLE LIST
// ============================================================
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
    if (!allTables.length) { list.innerHTML = '<div class="sidebar-loading">No tables found</div>'; return; }
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

// ============================================================
//  TABLE VIEW
// ============================================================
async function loadTableView(tableName) {
    currentTable = tableName;
    currentPage  = 1;
    showView('view-table');
    setActiveNav(`nav-table-${tableName}`);

    const formatted = formatTableName(tableName);
    document.getElementById('table-view-title').innerHTML      = `<i class="fa-solid fa-table"></i> ${formatted}`;
    document.getElementById('table-view-subtitle').textContent = `Manage records in "${tableName}"`;
    document.getElementById('breadcrumb').innerHTML            = `<i class="fa-solid fa-table"></i> ${formatted}`;
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
                if (typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))) {
                    return `<td><a href="${v}" target="_blank" style="color:var(--green);font-size:12px;">View</a></td>`;
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

function refreshTable() { if (currentTable) fetchTableData(); }

// ============================================================
//  OVERVIEW STATS
// ============================================================
async function loadOverviewStats() {
    // Total Pharmacies = users with role 'pharmacist'
    // NOTE: Requires RLS policy on public.users allowing admin to SELECT all rows.
    // If count returns 0 unexpectedly, add this policy in Supabase:
    //   CREATE POLICY "admin_read_all_users" ON public.users FOR SELECT
    //   TO authenticated USING (EXISTS (
    //     SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'
    //   ));
    try {
        const { count, error } = await sb.from('users').select('*', { count: 'exact', head: true }).eq('role', 'pharmacist');
        if (error) throw error;
        document.getElementById('stat-pharmacies').textContent = count ?? '0';
    } catch { document.getElementById('stat-pharmacies').textContent = '—'; }

    try {
        const { count } = await sb.from('pharmacy_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending');
        document.getElementById('request-badge').textContent = count > 0 ? count : '';
        document.getElementById('stat-pending').textContent  = count ?? '—';
    } catch { document.getElementById('stat-pending').textContent = '—'; }

    // Registered Users = users with role 'user' (patients)
    try {
        const { count, error } = await sb.from('users').select('*', { count: 'exact', head: true }).eq('role', 'user');
        if (error) throw error;
        document.getElementById('stat-users').textContent = count ?? '0';
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

// ============================================================
//  PHARMACY REQUESTS — Load & Render
// ============================================================
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
            </div>`;
    }
}

function renderRequestCard(r) {
    const skipInCard = ['id', 'status', 'created_at', 'updated_at', 'rejection_reason', 'doc_folder_path'];
    const displayFields = Object.entries(r)
        .filter(([k]) => !skipInCard.includes(k))
        .map(([k, v]) => `
            <div class="request-field">
                <div class="request-field-label">${k.replace(/_/g, ' ')}</div>
                <div class="request-field-value">${v !== null && v !== undefined ? String(v) : '<span class="null-badge">—</span>'}</div>
            </div>
        `).join('');

    const folderPath = r.doc_folder_path || '';
    const docsHtml = folderPath
        ? `<div class="request-docs" id="docs-${r.id}">
               <span class="docs-label"><i class="fa-solid fa-paperclip"></i> Documents:</span>
               <button class="doc-load-btn" onclick="loadDocLinks('${r.id}', '${folderPath}', this)">
                   <i class="fa-solid fa-folder-open"></i> Load Documents
               </button>
           </div>`
        : `<div class="request-docs"><span class="docs-label" style="color:#aaa"><i class="fa-solid fa-triangle-exclamation"></i> No documents uploaded</span></div>`;

    const name    = r.pharmacy_name || `Request #${r.id}`;
    const created = r.created_at
        ? new Date(r.created_at).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })
        : '';

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
                    <button class="btn-reject" onclick="openRejectModal('${r.id}', '${safeEmail}', '${safeName}', '${r.doc_folder_path || ''}')">
                        <i class="fa-solid fa-times"></i> Reject
                    </button>
                </div>
            </div>
        </div>
    `;
}

// ============================================================
//  LOAD DOCUMENTS FROM STORAGE
// ============================================================
async function loadDocLinks(requestId, folderPath, btn) {
    btn.disabled  = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading…';

    try {
        const { data: files, error } = await sb.storage
            .from('pharmacy-docs')
            .list(folderPath, { sortBy: { column: 'name', order: 'asc' } });

        if (error) throw error;

        const docsContainer = document.getElementById(`docs-${requestId}`);

        if (!files || files.length === 0) {
            docsContainer.innerHTML = `<span class="docs-label" style="color:#aaa"><i class="fa-solid fa-triangle-exclamation"></i> Folder exists but contains no files</span>`;
            return;
        }

        const links = files.map((file, i) => {
            const { data: urlData } = sb.storage.from('pharmacy-docs').getPublicUrl(`${folderPath}/${file.name}`);
            const icon  = file.name.toLowerCase().endsWith('.pdf') ? 'fa-file-pdf' : file.name.match(/\.(jpg|jpeg|png|webp)$/i) ? 'fa-file-image' : 'fa-file';
            const label = file.name.replace(/^doc_\d+_/, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ') || `Document ${i + 1}`;
            return `<a href="${urlData.publicUrl}" target="_blank" class="doc-link"><i class="fa-solid ${icon}"></i> ${label}</a>`;
        }).join('');

        docsContainer.innerHTML = `<span class="docs-label"><i class="fa-solid fa-paperclip"></i> Documents (${files.length}):</span>${links}`;
    } catch (e) {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fa-solid fa-folder-open"></i> Retry Load';
        showToast(`Could not load documents: ${e.message}`, 'error');
    }
}

// ============================================================
//  APPROVE REQUEST
//  Delegates to the approve-pharmacy Edge Function which:
//  • Creates auth account with temp password
//  • Inserts users / profiles / pharmacies rows
//  • Deletes from pharmacy_requests
//  • Sends approval email with login credentials
// ============================================================
async function approveRequest(requestId, btn) {
    btn.disabled  = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.4);border-top-color:white"></div> Approving...';

    try {
        const { data, error } = await sb.functions.invoke('approve-pharmacy', {
            body: { requestId }
        });

        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Approval failed.');

        // Get pharmacy name for the toast (card still exists in DOM)
        const card = document.getElementById(`req-card-${requestId}`);
        const nameEl = card?.querySelector('.request-pharmacy-name');
        const pharmacyName = nameEl?.childNodes[1]?.textContent?.trim() || 'Pharmacy';

        animateCardOut(`req-card-${requestId}`, 'right');
        showToast(`✓ ${pharmacyName} approved! Login credentials sent to pharmacist.`, 'success');
        await updatePendingBadge();

    } catch (e) {
        showToast(`Approval error: ${e.message}`, 'error');
        btn.disabled  = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Approve';
    }
}

// ============================================================
//  REJECT REQUEST
//  Sends rejection email via existing send-email Edge Function,
//  then deletes the pharmacy_requests row.
// ============================================================
function openRejectModal(requestId, email, pharmacyName, docFolderPath) {
    pendingRejectId     = requestId;
    pendingRejectEmail  = email;
    pendingRejectName   = pharmacyName;
    pendingRejectFolder = docFolderPath || null;
    document.getElementById('reject-pharmacy-name').value = pharmacyName;
    document.getElementById('reject-reason').value        = '';
    openModal('reject-modal');
}

async function confirmReject() {
    const reason = document.getElementById('reject-reason').value.trim();
    if (!reason) { showToast('Please enter a rejection reason.', 'error'); return; }

    const btn     = document.querySelector('#reject-modal .btn-modal-danger');
    btn.disabled  = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.4);border-top-color:white"></div> Processing...';

    try {
        // 1. Send rejection email + cleanup docs via send-reject-email Edge Function
        const { data: emailData, error: emailErr } = await sb.functions.invoke('send-reject-email', {
            body: {
                to:            pendingRejectEmail,
                subject:       'MediFinder — Pharmacy Registration Update',
                type:          'rejection',
                pharmacyName:  pendingRejectName,
                reason,
                docFolderPath: pendingRejectFolder  // Edge Function will delete these files
            }
        });

        // Check for edge function invocation error or application-level error
        if (emailErr) throw new Error(`Email failed: ${emailErr.message}`);
        if (emailData && emailData.error) throw new Error(`Email failed: ${emailData.error}`);

        // 2. Delete from pharmacy_requests
        const { error: deleteErr } = await sb.from('pharmacy_requests').delete().eq('id', pendingRejectId);
        if (deleteErr) throw new Error(`Could not remove request: ${deleteErr.message}`);

        animateCardOut(`req-card-${pendingRejectId}`, 'left');
        closeModal('reject-modal');
        showToast('Request rejected and pharmacy notified by email.', 'success');
        await updatePendingBadge();

    } catch (e) {
        showToast(`Reject error: ${e.message}`, 'error');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fa-solid fa-times"></i> Confirm Rejection';
    }
}

// ============================================================
//  HELPERS
// ============================================================
function animateCardOut(cardId, direction = 'right') {
    const card = document.getElementById(cardId);
    if (!card) return;
    card.style.transition = 'all 0.4s ease';
    card.style.opacity    = '0';
    card.style.transform  = `translateX(${direction === 'right' ? '30px' : '-30px'})`;
    setTimeout(() => {
        card.remove();
        if (!document.querySelectorAll('.request-card').length) {
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

// ── Delete ──────────────────────────────────────────────────
function openDeleteModal(rowId) { pendingDeleteId = rowId; openModal('delete-modal'); }

async function confirmDelete() {
    const btn     = document.querySelector('#delete-modal .btn-modal-danger');
    btn.disabled  = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.4);border-top-color:white"></div> Deleting...';
    try {
        const pkColumn = currentTableColumns.includes('id') ? 'id' : currentTableColumns[0];
        const { error } = await sb.from(currentTable).delete().eq(pkColumn, pendingDeleteId);
        if (error) throw error;
        closeModal('delete-modal');
        showToast('Record deleted.', 'success');
        await fetchTableData();
    } catch (e) {
        showToast(`Delete failed: ${e.message}`, 'error');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
    }
}

// ── Edit ────────────────────────────────────────────────────
function openEditModal(row) {
    const pkColumn = 'id' in row ? 'id' : Object.keys(row)[0];
    pendingEditId  = row[pkColumn];
    const skip     = ['id', 'created_at', 'approved_at'];
    const fields   = Object.entries(row)
        .filter(([k]) => !skip.includes(k))
        .map(([k, v]) => {
            const val = Array.isArray(v) ? v.join(', ') : (v !== null && v !== undefined ? String(v) : '');
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
    const btn     = document.querySelector('#edit-modal .btn-modal-primary');
    btn.disabled  = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.4);border-top-color:white"></div> Saving...';
    try {
        const updates = {};
        document.querySelectorAll('#edit-modal-body input').forEach(inp => {
            updates[inp.name] = inp.value === '' ? null : inp.value;
        });
        const pkColumn = currentTableColumns.includes('id') ? 'id' : currentTableColumns[0];
        const { error } = await sb.from(currentTable).update(updates).eq(pkColumn, pendingEditId);
        if (error) throw error;
        closeModal('edit-modal');
        showToast('Record updated.', 'success');
        await fetchTableData();
    } catch (e) {
        showToast(`Update failed: ${e.message}`, 'error');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fa-solid fa-save"></i> Save Changes';
    }
}

// ── Add Row ─────────────────────────────────────────────────
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
    const btn     = document.querySelector('#add-modal .btn-modal-primary');
    btn.disabled  = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-color:rgba(255,255,255,0.4);border-top-color:white"></div> Adding...';
    try {
        const newRow = {};
        document.querySelectorAll('#add-modal-body input').forEach(inp => {
            if (inp.value !== '') newRow[inp.name] = inp.value;
        });
        const { error } = await sb.from(currentTable).insert([newRow]);
        if (error) throw error;
        closeModal('add-modal');
        showToast('Row added.', 'success');
        await fetchTableData();
    } catch (e) {
        showToast(`Insert failed: ${e.message}`, 'error');
    } finally {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Row';
    }
}

// ── Modals ──────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { document.getElementById(id).classList.remove('open'); document.body.style.overflow = ''; }
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') ['reject-modal','delete-modal','edit-modal','add-modal'].forEach(closeModal);
});

// ── Toast ───────────────────────────────────────────────────
function showToast(message, type = 'success') {
    const icons   = { success: 'fa-circle-check', error: 'fa-circle-exclamation', warning: 'fa-triangle-exclamation' };
    const toast   = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.success}"></i><span>${message}</span>`;
    toast.onclick   = () => toast.remove();
    document.getElementById('toast-container').appendChild(toast);
    setTimeout(() => { toast.style.animation = 'toastOut 0.3s ease forwards'; setTimeout(() => toast.remove(), 300); }, 4000);
}

// ── Logout ──────────────────────────────────────────────────
async function handleLogout() { await sb.auth.signOut(); window.location.href = 'Login.html'; }
