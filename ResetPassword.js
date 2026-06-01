/* ============================================================
   MediFinder — ResetPassword.js

   HOW SUPABASE DELIVERS THE USER HERE:
   After the user clicks the reset link in their email,
   Supabase redirects to this page with the session tokens
   embedded in the URL fragment (hash), e.g.:

   ResetPassword.html#access_token=XXX&refresh_token=YYY&type=recovery

   Supabase JS v2 automatically parses this fragment via
   onAuthStateChange(), firing a 'PASSWORD_RECOVERY' event
   when it detects type=recovery. We listen for that event
   to confirm the link is valid before showing the form.

   If no recovery event fires within a short timeout,
   we show the "invalid/expired link" state instead.

   FLOW:
   1. Page loads → show "Verifying…" spinner
   2. supabaseClient.auth.onAuthStateChange listens for
      event === 'PASSWORD_RECOVERY'
   3a. Recovery event → show new-password form
   3b. No event / SIGNED_OUT → show invalid-link state
   4. User submits new password → supabaseClient.auth.updateUser()
   5. Success → show success state + auto-redirect to Login.html
   ============================================================ */
(function () {
    'use strict';

    const db = window.supabaseClient;

    /* ── DOM refs ── */
    const stateLoading  = document.getElementById('stateLoading');
    const stateInvalid  = document.getElementById('stateInvalid');
    const stateForm     = document.getElementById('stateForm');
    const stateSuccess  = document.getElementById('stateSuccess');
    const resetForm     = document.getElementById('resetForm');
    const rpSubmitBtn   = document.getElementById('rpSubmitBtn');
    const rpFormMessage = document.getElementById('rpFormMessage');
    const pwInput       = document.getElementById('rp-password');
    const confirmInput  = document.getElementById('rp-confirm');
    const strengthFill  = document.getElementById('pwStrengthFill');
    const strengthLabel = document.getElementById('pwStrengthLabel');
    const redirectCount = document.getElementById('redirectCountdown');

    /* ── State helper ── */
    function showState(id) {
        [stateLoading, stateInvalid, stateForm, stateSuccess].forEach(el => {
            if (el) el.classList.remove('rp-state--active');
        });
        const target = document.getElementById(id);
        if (target) target.classList.add('rp-state--active');
    }

    /* ── Message helper ── */
    function showMsg(text, type /* 'error' | 'success' */) {
        rpFormMessage.textContent = text;
        rpFormMessage.className   = `rp-message rp-message--${type} rp-message--show`;
    }
    function hideMsg() {
        rpFormMessage.className = 'rp-message';
        rpFormMessage.textContent = '';
    }

    /* ── Loading button helper ── */
    function setLoading(loading) {
        rpSubmitBtn.disabled    = loading;
        rpSubmitBtn.textContent = loading ? 'Updating…' : 'Update Password';
    }

    /* ── Password strength indicator ── */
    function checkStrength(val) {
        let score = 0;
        if (val.length >= 8)  score++;
        if (val.length >= 12) score++;
        if (/[A-Z]/.test(val)) score++;
        if (/[0-9]/.test(val)) score++;
        if (/[^A-Za-z0-9]/.test(val)) score++;

        const levels = [
            { pct: 0,   color: '',          label: '' },
            { pct: 20,  color: '#dc2626',   label: 'Very weak' },
            { pct: 40,  color: '#f97316',   label: 'Weak' },
            { pct: 60,  color: '#eab308',   label: 'Fair' },
            { pct: 80,  color: '#22c55e',   label: 'Strong' },
            { pct: 100, color: '#16a34a',   label: 'Very strong' }
        ];

        const level = val.length === 0 ? levels[0] : levels[Math.min(score, 5)];
        strengthFill.style.width           = level.pct + '%';
        strengthFill.style.backgroundColor = level.color;
        strengthLabel.textContent          = level.label;
        strengthLabel.style.color          = level.color;
    }

    /* ── Password toggle ── */
    document.querySelectorAll('.toggle-password').forEach(icon => {
        icon.addEventListener('click', function () {
            const input = this.previousElementSibling;
            if (!input) return;
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            this.classList.toggle('fa-eye-slash');
            this.classList.toggle('fa-eye');
        });
    });

    /* ── Live strength update ── */
    if (pwInput) {
        pwInput.addEventListener('input', () => checkStrength(pwInput.value));
    }

    /* ── Token validation via onAuthStateChange ── */
    if (!db) {
        // SDK unavailable — show invalid state
        showState('stateInvalid');
    } else {
        /*
         Supabase v2 automatically reads the URL fragment on page load.
         The PASSWORD_RECOVERY event fires only when the fragment contains
         a valid, non-expired recovery token (type=recovery).
         We set a generous 6-second timeout: if no event arrives the link
         is either expired, already used, or the URL is wrong.
        */
        let resolved = false;

        const { data: { subscription } } = db.auth.onAuthStateChange((event) => {
            if (resolved) return;

            if (event === 'PASSWORD_RECOVERY') {
                resolved = true;
                subscription.unsubscribe();
                showState('stateForm');
            } else if (event === 'SIGNED_IN') {
                /*
                 SIGNED_IN can fire for regular sessions. Only treat it as
                 recovery if the URL fragment contains type=recovery.
                */
                const hash   = window.location.hash;
                const params = new URLSearchParams(hash.replace(/^#/, ''));
                if (params.get('type') === 'recovery') {
                    resolved = true;
                    subscription.unsubscribe();
                    showState('stateForm');
                }
            } else if (event === 'SIGNED_OUT') {
                resolved = true;
                subscription.unsubscribe();
                showState('stateInvalid');
            }
        });

        /* Fallback timeout — if no auth event fires, treat link as invalid */
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                subscription.unsubscribe();
                showState('stateInvalid');
            }
        }, 6000);
    }

    /* ── Form submission — update password ── */
    if (resetForm) {
        resetForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            hideMsg();

            const newPassword = pwInput.value;
            const confirm     = confirmInput.value;

            /* Validation */
            if (!newPassword || newPassword.length < 8) {
                showMsg('Password must be at least 8 characters long.', 'error');
                pwInput.focus();
                return;
            }
            if (newPassword !== confirm) {
                showMsg('Passwords do not match. Please re-enter your new password.', 'error');
                confirmInput.focus();
                return;
            }

            setLoading(true);

            try {
                const { error } = await db.auth.updateUser({ password: newPassword });

                if (error) throw error;

                /* Sign out so the old session isn't reused on the next login */
                await db.auth.signOut();

                showState('stateSuccess');
                startRedirectCountdown();

            } catch (err) {
                console.error('Password update error:', err);
                showMsg(friendlyError(err.message), 'error');
                setLoading(false);
            }
        });
    }

    /* ── Auto-redirect countdown after success ── */
    function startRedirectCountdown() {
        let secs = 5;
        const interval = setInterval(() => {
            secs -= 1;
            if (redirectCount) redirectCount.textContent = secs;
            if (secs <= 0) {
                clearInterval(interval);
                window.location.href = 'Login.html';
            }
        }, 1000);
    }

    /* ── Friendly error messages ── */
    function friendlyError(message = '') {
        const msg = message.toLowerCase();
        if (msg.includes('jwt expired') || msg.includes('token expired') || msg.includes('invalid token'))
            return 'Your reset link has expired. Please request a new one.';
        if (msg.includes('same password') || msg.includes('different from the old password'))
            return 'New password must be different from your current password.';
        if (msg.includes('weak password') || msg.includes('should be at least'))
            return 'Password is too weak. Please use at least 8 characters with a mix of letters and numbers.';
        return message || 'Something went wrong. Please try again.';
    }

})();
