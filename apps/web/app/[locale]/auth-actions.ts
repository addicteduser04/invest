'use server';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { asLocale } from '@/lib/i18n';

export async function register(formData: FormData) {
  const locale = asLocale(String(formData.get('locale') ?? 'fr'));
  const email = String(formData.get('email'));
  const password = String(formData.get('password'));
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { locale, display_name: String(formData.get('displayName') ?? '') } },
  });
  if (error) redirect(`/${locale}/register?error=registration`);
  redirect(`/${locale}/dashboard`);
}

export async function login(formData: FormData) {
  const locale = asLocale(String(formData.get('locale') ?? 'fr'));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get('email')),
    password: String(formData.get('password')),
  });
  if (error) redirect(`/${locale}/login?error=credentials`);
  redirect(`/${locale}/dashboard`);
}

export async function logout(formData: FormData) {
  const locale = asLocale(String(formData.get('locale') ?? 'fr'));
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/${locale}`);
}

export async function createPortfolio(formData: FormData) {
  const locale = asLocale(String(formData.get('locale') ?? 'fr'));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const mode = formData.get('trackingMode') === 'virtual' ? 'virtual' : 'real_tracking';
  const { error } = await supabase.from('portfolios').insert({
    owner_id: user.id,
    name: String(formData.get('name')),
    base_currency: 'MAD',
    tracking_mode: mode,
  });
  if (error) throw new Error(error.message);
  redirect(`/${locale}/dashboard`);
}

export async function addTransaction(formData: FormData) {
  const locale = asLocale(String(formData.get('locale') ?? 'fr'));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const type = String(formData.get('type'));
  const amount = formData.get('amount') ? String(formData.get('amount')) : null;
  const portfolioId = String(formData.get('portfolioId'));
  const settlementDate = formData.get('settlementDate')
    ? String(formData.get('settlementDate'))
    : new Date().toISOString().slice(0, 10);
  const { error } = await supabase.rpc('record_transaction', {
    p_portfolio_id: portfolioId,
    p_type: type,
    p_settlement_date: settlementDate,
    p_idempotency_key: crypto.randomUUID(),
    p_amount: amount,
    p_security_id: formData.get('securityId') ? String(formData.get('securityId')) : null,
    p_quantity: formData.get('quantity') ? String(formData.get('quantity')) : null,
    p_unit_price: formData.get('unitPrice') ? String(formData.get('unitPrice')) : null,
    p_fees: formData.get('fees') ? String(formData.get('fees')) : '0',
    p_taxes: formData.get('taxes') ? String(formData.get('taxes')) : '0',
  });
  if (error) throw new Error(error.message);
  redirect(`/${locale}/dashboard?portfolio=${encodeURIComponent(portfolioId)}`);
}

export async function requestPasswordReset(formData: FormData) {
  const locale = asLocale(String(formData.get('locale') ?? 'fr'));
  const email = String(formData.get('email') ?? '').trim();
  const requestHeaders = await headers();
  const origin = requestHeaders.get('origin');
  if (!origin || !email) redirect(`/${locale}/forgot-password?sent=1`);
  const supabase = await createClient();
  const next = encodeURIComponent(`/${locale}/reset-password`);
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=${next}`,
  });
  redirect(`/${locale}/forgot-password?sent=1`);
}

export async function updatePassword(formData: FormData) {
  const locale = asLocale(String(formData.get('locale') ?? 'fr'));
  const password = String(formData.get('password') ?? '');
  if (password.length < 10) redirect(`/${locale}/reset-password?error=password`);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(`/${locale}/reset-password?error=password`);
  redirect(`/${locale}/dashboard`);
}

export async function updateProfileSettings(formData: FormData) {
  const currentLocale = asLocale(String(formData.get('currentLocale') ?? 'fr'));
  const locale = asLocale(String(formData.get('preferredLocale') ?? currentLocale));
  const displayName = String(formData.get('displayName') ?? '')
    .trim()
    .slice(0, 120);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${currentLocale}/login`);
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName, locale, updated_at: new Date().toISOString() })
    .eq('id', user.id);
  if (error) throw new Error(error.message);
  const cookieStore = await cookies();
  cookieStore.set('saif_locale', locale, {
    path: '/',
    maxAge: 31_536_000,
    sameSite: 'lax',
  });
  redirect(`/${locale}/settings?saved=1`);
}

export async function renamePortfolio(formData: FormData) {
  const locale = asLocale(String(formData.get('locale') ?? 'fr'));
  const portfolioId = String(formData.get('portfolioId') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!portfolioId || name.length < 1 || name.length > 100)
    throw new Error('Invalid portfolio name');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);
  const { error } = await supabase
    .from('portfolios')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', portfolioId)
    .eq('owner_id', user.id);
  if (error) throw new Error(error.message);
  redirect(`/${locale}/settings?saved=1`);
}

export async function archivePortfolio(formData: FormData) {
  const locale = asLocale(String(formData.get('locale') ?? 'fr'));
  const portfolioId = String(formData.get('portfolioId') ?? '');
  if (!portfolioId) throw new Error('Invalid portfolio');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);
  const { error } = await supabase
    .from('portfolios')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', portfolioId)
    .eq('owner_id', user.id);
  if (error) throw new Error(error.message);
  redirect(`/${locale}/settings?saved=1`);
}

export async function restorePortfolio(formData: FormData) {
  const locale = asLocale(String(formData.get('locale') ?? 'fr'));
  const portfolioId = String(formData.get('portfolioId') ?? '');
  if (!portfolioId) throw new Error('Invalid portfolio');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);
  const { error } = await supabase
    .from('portfolios')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', portfolioId)
    .eq('owner_id', user.id);
  if (error) throw new Error(error.message);
  redirect(`/${locale}/settings?saved=1`);
}
