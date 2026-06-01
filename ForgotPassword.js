/* ============================================================
   MediFinder — ForgotPassword.js

   FLOW:
   1. User enters their email and submits the form.
   2. supabaseClient.auth.resetPasswordForEmail() is called.
      • Supabase sends a password-reset email with a magic link.
      • The link redirects to ResetPassword.html with a token
        embedded in the URL hash (#access_token=...&type=recovery).
   3. UI transitions to the "check your email" success state.
   4. A 60-second cooldown prevents spam-clicking Resend.

   IMPORTANT — Supabase dashboard settings required:
   • Authentication → URL Configuration → Site URL:
       https://noemahmedkhan.github.io/FYDP
   • Authentication → URL Configuration → Redirect URLs:
       https://noemahmedkhan.github.io/FYDP/ResetPassword.html
   ============================================================ */
(function () {
    'use strict';

    /* ── Supabase client ── */
    const db = window.supabaseClient;

    /* ── DOM refs ── */
    const stateForm     = document.getElementById('stateForm');
    const stateSuccess  = document.getElementById('stateSuccess');
    const forgotForm    = document.getElementById('forgotForm');
    const fpSubmitBtn   = document.getElementById('fpSubmitBtn');
    const formMessage   = document.getElementById('formMessage');
    const successEmail  = document.getElementById('successEmail');
    const resendBtn     = document.getElementById('resendBtn');
    const resendMsg     = document.getElementById('resendMessage');
    const resendCount   = document.getElementById('resendCountdown');

    /* Stores the email so Resend can reuse it */
    let lastEmail = '';

    /* Cooldown timer handle */
    let cooldownTimer = null;
    const COOLDOWN_SECONDS = 60;

    /* ── Helpers ── */
    function showState(id) {
        document.querySelectorAll('.fp-state').forEach(el => {
            el.classList.remove('fp-state--active');
        });
        document.getElementById(id).classList.add('fp-state--active');
    }

    function showMsg(el, text, type /* 'error' | 'info' */) {
        el.textContent = text;
        el.className   = `fp-message fp-message--${type} fp-message--show`;
    }

    function hideMsg(el) {
        el.className = 'fp-message';
        el.textContent = '';
    }

    function setLoading(loading) {
        fpSubmitBtn.disabled    = loading;
        fpSubmitBtn.textContent = loading ? 'Sending…' : 'Send Reset Link';
    }

    /* Starts a 60-second countdown before the Resend button re-enables */
    function startResendCooldown() {
        resendBtn.disabled = true;
        let remaining = COOLDOWN_SECONDS;

        resendCount.textContent = `(wait ${remaining}s)`;

        cooldownTimer = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(cooldownTimer);
                resendBtn.disabled      = false;
                resendCount.textContent = '';
            } else {
                resendCount.textContent = `(wait ${remaining}s)`;
            }
        }, 1000);
    }

    /* Calls Supabase and returns { ok: true } or { ok: false, msg: '...' } */
    async function sendResetEmail(email) {
        if (!db) return { ok: false, msg: 'Authentication service unavailable. Please refresh and try again.' };

        const { error } = await db.auth.resetPasswordForEmail(email, {
            redirectTo: 'https://noemahmedkhan.github.io/FYDP/ResetPassword.html'
        });

        if (error) {
            return { ok: false, msg: friendlyError(error.message) };
        }
        return { ok: true };
    }

    /* ── Form submit ── */
    forgotForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideMsg(formMessage);

        const email = document.getElementById('fp-email').value.trim();

        if (!email) {
            showMsg(formMessage, 'Please enter your email address.', 'error');
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showMsg(formMessage, 'Please enter a valid email address.', 'error');
            return;
        }

        setLoading(true);

        const result = await sendResetEmail(email);

        setLoading(false);

        if (!result.ok) {
            showMsg(formMessage, result.msg, 'error');
            return;
        }

        /* Success → transition to check-email state */
        lastEmail = email;
        successEmail.textContent = email;
        showState('stateSuccess');
        startResendCooldown();
    });

    /* ── Resend button ── */
    resendBtn.addEventListener('click', async function () {
        hideMsg(resendMsg);
        resendBtn.disabled      = true;
        resendBtn.textContent   = 'Resending…';

        const result = await sendResetEmail(lastEmail);

        resendBtn.textContent = 'Didn\'t receive it? Resend email';

        if (!result.ok) {
            showMsg(resendMsg, result.msg, 'error');
            resendBtn.disabled = false;
            return;
        }

        showMsg(resendMsg, 'Reset email resent successfully. Please check your inbox.', 'info');
        startResendCooldown();
    });

    /* ── Friendly error messages ── */
    function friendlyError(message = '') {
        const msg = message.toLowerCase();
        if (msg.includes('user not found') || msg.includes('invalid email'))
            return 'No account found with that email address.';
        if (msg.includes('too many requests') || msg.includes('rate limit'))
            return 'Too many attempts. Please wait a few minutes before trying again.';
        if (msg.includes('email not confirmed'))
            return 'This email address has not been verified. Please verify your email first.';
        return message || 'Something went wrong. Please try again.';
    }

})();
