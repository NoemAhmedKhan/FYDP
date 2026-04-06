// supabase.js
// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL: Must assign to window.supabaseClient (not just const supabaseClient)
// so that UserProfile.js and all other pages can access it via window.supabaseClient.
// A plain `const` is block-scoped to this script — other scripts cannot see it.
// ─────────────────────────────────────────────────────────────────────────────
const { createClient } = window.supabase;
 
window.supabaseClient = createClient(
    'https://ktzsshlllyjuzphprzso.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic'
);
