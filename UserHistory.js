/* =============================================
   MediFinder — UserHistory.js  v4.0
   ─────────────────────────────────────────────
   CHANGES IN v4.0:
   A. Prescription Vault section now loads REAL
      data from Supabase (user_prescriptions table,
      max 5 rows). Previously it was static HTML.
   B. Each prescription shows as a small clickable
      card that opens the file URL in a lightbox
      modal overlay (with a close × button).
   C. "View All Files" button removed — the panel
      now shows all stored prescriptions (≤ 5).
   D. History panel "View All" link removed from
      panel__header (requirements update).
   E. All other v3.0 logic (paginated table, most
      frequent, last search) is UNCHANGED.
   ============================================= */

(function () {
    'use strict';

    /* =============================================
       CONSTANTS
       ============================================= */
    const PAGE_SIZE = 8;   // rows per page in history table

    /* =============================================
       DOM REFERENCES
       ============================================= */
    const sidebar        = document.getElementById('sidebar');
    const hamburgerBtn   = document.getElementById('hamburgerBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    /* =============================================
       1. SIDEBAR MOBILE TOGGLE
       ============================================= */
    function openSidebar()  { sidebar.classList.add('sidebar--open');    document.body.style.overflow = 'hidden'; }
    function closeSidebar() { sidebar.classList.remove('sidebar--open'); document.body.style.overflow = ''; }

    hamburgerBtn   && hamburgerBtn.addEventListener('click', () =>
        sidebar.classList.contains('sidebar--open') ? closeSidebar() : openSidebar()
    );
    sidebarOverlay && sidebarOverlay.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', e => e.key === 'Escape' && closeSidebar());

    /* =============================================
       2. AUTH GUARD + PAGE INIT
       ─────────────────────────────────────────────
       No session → redirect to Login.html.
       Session OK → load sidebar profile + data.
       ============================================= */
    async function initPage() {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error || !session) { window.location.href = 'Login.html'; return; }

        // Load sidebar profile details
        try {
            const { data: profile } = await supabaseClient
                .from('users')
                .select('first_name, last_name, profile_img')
                .eq('id', session.user.id)
                .single();

            if (profile) {
                const fullName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
                const nameEl   = document.getElementById('sidebarUserName');
                const emailEl  = document.getElementById('sidebarUserEmail');
                if (nameEl)  nameEl.textContent  = fullName || 'User';
                if (emailEl) emailEl.textContent = session.user.email || '';
                renderSidebarAvatar(profile.profile_img || null);
            }
        } catch (err) {
            console.warn('Profile load error:', err.message);
        }

        // Load history + prescription vault in parallel
        await Promise.all([
            loadHistory(session.user.id),
            loadPrescriptionVault(session.user.id),
        ]);
    }

    /* =============================================
       3. SIDEBAR AVATAR RENDERER
       ============================================= */
    function renderSidebarAvatar(profileImgUrl) {
        const avatarEl = document.querySelector('.user-avatar');
        if (!avatarEl) return;
        const fallback = avatarEl.querySelector('.user-avatar__fallback');
        const existing = avatarEl.querySelector('img');
        if (existing) existing.remove();

        const img   = document.createElement('img');
        img.alt     = 'User Avatar';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;position:relative;z-index:1;';
        img.onerror = () => { img.remove(); if (fallback) fallback.style.display = 'flex'; };
        img.onload  = () => { if (fallback) fallback.style.display = 'none'; };
        img.src     = profileImgUrl || 'Images/ProfileAvatar.jpg';
        avatarEl.insertBefore(img, avatarEl.firstChild);
    }

    /* =============================================
       4. LOAD SEARCH HISTORY
       ─────────────────────────────────────────────
       Fetches ≤20 rows for this user, newest-first.
       Uses composite index (user_id, searched_at DESC).
       Fields: product_name, category, searched_at
       ============================================= */
    async function loadHistory(userId) {
        try {
            const { data, error } = await supabaseClient
                .from('user_search_history')
                .select('product_name, category, searched_at')
                .eq('user_id', userId)
                .order('searched_at', { ascending: false })
                .limit(20);

            if (error) throw error;

            const rows = data || [];
            renderLastSearch(rows);
            renderMostFrequent(rows);
            renderTable(rows, 1);

        } catch (err) {
            console.error('History load error:', err.message);
            renderTableError();
        }
    }

    /* =============================================
       5. LAST SEARCH — card (right column)
       ─────────────────────────────────────────────
       rows are newest-first so rows[0] is the most
       recent search the user performed.
       ============================================= */
    function renderLastSearch(rows) {
        const el = document.getElementById('lastSearchValue');
        if (!el) return;
        el.textContent = rows.length > 0 ? rows[0].product_name : 'No searches yet';
    }

    /* =============================================
       6. MOST FREQUENT — header card
       ─────────────────────────────────────────────
       Counts occurrences of each product_name.
       Winner displayed in the "Most Frequent" banner.
       Ties broken by order of first appearance.
       ============================================= */
    function renderMostFrequent(rows) {
        const el = document.getElementById('mostFrequentName');
        if (!el) return;

        if (rows.length === 0) { el.textContent = 'No data yet'; return; }

        const freq = {};
        rows.forEach(r => {
            const key = (r.product_name || '').trim().toLowerCase();
            if (!key) return;
            if (!freq[key]) freq[key] = { name: r.product_name, count: 0 };
            freq[key].count++;
        });

        const top = Object.values(freq).sort((a, b) => b.count - a.count)[0];
        el.textContent = top ? top.name : '—';
    }

    /* =============================================
       7. RENDER TABLE (paginated — 8 rows/page)
       ─────────────────────────────────────────────
       Slices rows for the requested page, injects
       them into #historyTableBody, then renders the
       page-slider controls below the table.
       ============================================= */
    const ICON_PALETTE = [
        { cls: 'med-icon--indigo', icon: 'fa-kit-medical' },
        { cls: 'med-icon--red',    icon: 'fa-pills' },
        { cls: 'med-icon--amber',  icon: 'fa-eye' },
        { cls: 'med-icon--cyan',   icon: 'fa-droplet' },
        { cls: 'med-icon--pink',   icon: 'fa-pump-soap' },
        { cls: 'med-icon--green',  icon: 'fa-capsules' },
        { cls: 'med-icon--purple', icon: 'fa-syringe' },
        { cls: 'med-icon--teal',   icon: 'fa-heart-pulse' },
    ];

    function getIconStyle(index) {
        return ICON_PALETTE[index % ICON_PALETTE.length];
    }

    function renderTable(rows, page) {
        const bodyEl   = document.getElementById('historyTableBody');
        const sliderEl = document.getElementById('paginationSlider');
        if (!bodyEl) return;

        const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
        const safePage   = Math.min(Math.max(1, page), totalPages);
        const start      = (safePage - 1) * PAGE_SIZE;
        const pageRows   = rows.slice(start, start + PAGE_SIZE);

        // ── Table rows ──
        if (rows.length === 0) {
            bodyEl.innerHTML = `
                <li class="history-row history-row--empty">
                    <div class="history-row__query">
                        <div class="med-icon med-icon--indigo">
                            <i class="fa-solid fa-magnifying-glass"></i>
                        </div>
                        <div class="med-info">
                            <span class="med-info__name" style="color:var(--gray-mid)">No searches yet</span>
                            <span class="med-info__sub">Search for medicines to see history here</span>
                        </div>
                    </div>
                </li>`;
        } else {
            bodyEl.innerHTML = pageRows.map((row, i) => {
                const globalIndex = start + i;
                const palette     = getIconStyle(globalIndex);
                const category    = row.category || 'Medicine';
                const dateStr     = formatDate(row.searched_at);

                return `
                <li class="history-row">
                    <div class="history-row__query">
                        <div class="med-icon ${palette.cls}">
                            <i class="fa-solid ${palette.icon}"></i>
                        </div>
                        <div class="med-info">
                            <span class="med-info__name">${escapeHtml(row.product_name || '—')}</span>
                            <span class="med-info__sub">${escapeHtml(category)}</span>
                        </div>
                    </div>
                    <span class="history-row__category">Search</span>
                    <span class="history-row__date">${dateStr}</span>
                </li>`;
            }).join('');
        }

        // ── Page slider ──
        if (!sliderEl) return;

        if (totalPages <= 1) { sliderEl.innerHTML = ''; return; }

        sliderEl.innerHTML = `
            <div class="page-slider">
                <button class="page-btn page-btn--prev"
                    ${safePage === 1 ? 'disabled' : ''}
                    aria-label="Previous page">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <span class="page-info">Page <strong>${safePage}</strong> of <strong>${totalPages}</strong></span>
                <button class="page-btn page-btn--next"
                    ${safePage === totalPages ? 'disabled' : ''}
                    aria-label="Next page">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
            </div>`;

        sliderEl.querySelector('.page-btn--prev').addEventListener('click', () => renderTable(rows, safePage - 1));
        sliderEl.querySelector('.page-btn--next').addEventListener('click', () => renderTable(rows, safePage + 1));
    }

    /* =============================================
       8. TABLE ERROR STATE
       ============================================= */
    function renderTableError() {
        const bodyEl = document.getElementById('historyTableBody');
        if (bodyEl) {
            bodyEl.innerHTML = `
                <li class="history-row history-row--empty">
                    <div class="history-row__query">
                        <div class="med-icon med-icon--red">
                            <i class="fa-solid fa-circle-exclamation"></i>
                        </div>
                        <div class="med-info">
                            <span class="med-info__name" style="color:var(--red)">Failed to load history</span>
                            <span class="med-info__sub">Check your connection and refresh</span>
                        </div>
                    </div>
                </li>`;
        }
    }

    /* =============================================
       9. LOAD PRESCRIPTION VAULT  (NEW in v4.0)
       ─────────────────────────────────────────────
       Fetches the 5 most-recent prescriptions for
       this user from the user_prescriptions table,
       ordered newest-first.

       Renders them as small clickable thumbnail
       cards inside the .vault-grid element.

       Each card:
         • Shows a file icon (+ truncated filename)
         • On click → opens the file URL in a
           lightbox modal overlay
         • Modal has a × close button

       If no prescriptions exist, shows an empty
       state prompt encouraging the user to upload.
       ============================================= */
    async function loadPrescriptionVault(userId) {
        const vaultGrid = document.getElementById('vaultGrid');
        if (!vaultGrid) return;

        try {
            const { data, error } = await supabaseClient
                .from('user_prescriptions')
                .select('id, file_name, file_url, file_size, uploaded_at')
                .eq('user_id', userId)
                .order('uploaded_at', { ascending: false })
                .limit(5);

            if (error) throw error;

            const prescriptions = data || [];

            if (prescriptions.length === 0) {
                // Empty state — no prescriptions stored yet
                vaultGrid.innerHTML = `
                    <div class="vault-empty">
                        <i class="fa-solid fa-file-medical"></i>
                        <p>No prescriptions yet.<br>Upload one from Pharmacy Search.</p>
                    </div>`;
                return;
            }

            // Render one card per prescription (max 5)
            vaultGrid.innerHTML = prescriptions.map(rx => `
                <div class="vault-rx-card"
                     role="button"
                     tabindex="0"
                     title="View ${escapeHtml(rx.file_name)}"
                     data-url="${escapeHtml(rx.file_url)}"
                     data-name="${escapeHtml(rx.file_name)}"
                     data-date="${escapeHtml(formatDate(rx.uploaded_at))}">
                    <div class="vault-rx-card__icon">
                        <i class="fa-solid fa-file-prescription"></i>
                    </div>
                    <span class="vault-rx-card__name">${escapeHtml(truncateFileName(rx.file_name, 14))}</span>
                    <span class="vault-rx-card__date">${formatDate(rx.uploaded_at)}</span>
                </div>`
            ).join('');

            // Attach click listeners to open lightbox
            vaultGrid.querySelectorAll('.vault-rx-card').forEach(card => {
                const openModal = () => openPrescriptionModal(
                    card.dataset.url,
                    card.dataset.name,
                    card.dataset.date
                );
                card.addEventListener('click',   openModal);
                card.addEventListener('keydown', e => { if (e.key === 'Enter') openModal(); });
            });

        } catch (err) {
            console.warn('Vault load error:', err.message);
            if (vaultGrid) {
                vaultGrid.innerHTML = `
                    <div class="vault-empty" style="color:var(--red)">
                        <i class="fa-solid fa-circle-exclamation"></i>
                        <p>Could not load prescriptions.</p>
                    </div>`;
            }
        }
    }

    /* =============================================
       10. PRESCRIPTION MODAL LIGHTBOX  (NEW v4.0)
       ─────────────────────────────────────────────
       Opens a modal overlay showing the prescription
       image. Clicking the × button or backdrop closes
       the modal. Keyboard Escape also closes it.

       If the URL doesn't end with an image extension,
       falls back to showing a "Preview not available"
       message with a direct download link.
       ============================================= */
    function openPrescriptionModal(url, fileName, dateStr) {
        // Remove any existing modal first
        const existing = document.getElementById('rxModal');
        if (existing) existing.remove();

        const isImage = /\.(jpe?g|png|webp|gif)$/i.test(url);

        const modal     = document.createElement('div');
        modal.id        = 'rxModal';
        modal.className = 'rx-modal';
        modal.innerHTML = `
            <div class="rx-modal__backdrop"></div>
            <div class="rx-modal__box" role="dialog" aria-modal="true" aria-label="${escapeHtml(fileName)}">
                <div class="rx-modal__header">
                    <div class="rx-modal__title">
                        <i class="fa-solid fa-file-prescription"></i>
                        <span>${escapeHtml(fileName)}</span>
                    </div>
                    <div class="rx-modal__meta">${escapeHtml(dateStr)}</div>
                    <button class="rx-modal__close" id="rxModalClose" aria-label="Close">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="rx-modal__body">
                    ${isImage
                        ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(fileName)}" class="rx-modal__img">`
                        : `<div class="rx-modal__no-preview">
                                <i class="fa-solid fa-file-lines"></i>
                                <p>Preview not available for this file type.</p>
                                <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="rx-modal__download">
                                    <i class="fa-solid fa-download"></i> Open File
                                </a>
                           </div>`
                    }
                </div>
            </div>`;

        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';

        // Close handlers
        const close = () => {
            modal.remove();
            document.body.style.overflow = '';
        };

        document.getElementById('rxModalClose').addEventListener('click', close);
        modal.querySelector('.rx-modal__backdrop').addEventListener('click', close);
        document.addEventListener('keydown', function escClose(e) {
            if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); }
        });
    }

    /* =============================================
       11. LOGOUT
       ============================================= */
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async e => {
            e.preventDefault();
            await supabaseClient.auth.signOut();
            window.location.href = 'Login.html';
        });
    }

    /* =============================================
       12. UTILITY HELPERS
       ============================================= */

    /* Format ISO date → "Oct 24, 2024" */
    function formatDate(isoString) {
        if (!isoString) return '—';
        return new Date(isoString).toLocaleDateString('en-US', {
            day: 'numeric', month: 'short', year: 'numeric',
        });
    }

    /* Truncate long filenames to a readable length */
    function truncateFileName(name, maxLen) {
        if (!name || name.length <= maxLen) return name || '—';
        const ext = name.lastIndexOf('.');
        if (ext > 0) {
            const base = name.slice(0, ext);
            const extension = name.slice(ext);
            return base.slice(0, maxLen - extension.length - 1) + '…' + extension;
        }
        return name.slice(0, maxLen) + '…';
    }

    /* Prevent XSS when injecting user/DB data into innerHTML */
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g,  '&amp;')
            .replace(/</g,  '&lt;')
            .replace(/>/g,  '&gt;')
            .replace(/"/g,  '&quot;')
            .replace(/'/g,  '&#39;');
    }

    /* ─── INIT ─── */
    initPage();

})();
