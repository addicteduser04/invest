'use server';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { transactionInputSchema } from '@bvc/contracts';
import { createClient } from '@/lib/supabase/server';
import { asLocale } from '@/lib/i18n';

export type RecordTransactionState = {
  error?: string;
};

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
  const portfolioId = await recordTransactionCommand(formData);
  redirect(`/${locale}/dashboard?portfolio=${encodeURIComponent(portfolioId)}&recorded=1`);
}

export async function recordTransactionV2(
  _state: RecordTransactionState,
  formData: FormData,
): Promise<RecordTransactionState> {
  try {
    const locale = asLocale(String(formData.get('locale') ?? 'fr'));
    const portfolioId = await recordTransactionCommand(formData);
    redirect(`/${locale}/dashboard?portfolio=${encodeURIComponent(portfolioId)}&recorded=1`);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const locale = asLocale(String(formData.get('locale') ?? 'fr'));
    return { error: humanizeTransactionError(error, locale) };
  }
}

async function recordTransactionCommand(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const portfolioId = String(formData.get('portfolioId'));
  const settlementDate = formData.get('settlementDate')
    ? String(formData.get('settlementDate'))
    : new Date().toISOString().slice(0, 10);
  const amount = formData.get('amount')
    ? normalizeDecimal(String(formData.get('amount')))
    : undefined;
  const quantity = formData.get('quantity')
    ? normalizeDecimal(String(formData.get('quantity')))
    : undefined;
  const unitPrice = formData.get('unitPrice')
    ? normalizeDecimal(String(formData.get('unitPrice')))
    : undefined;
  const fees = formData.get('fees') ? normalizeDecimal(String(formData.get('fees'))) : '0';
  const taxes = formData.get('taxes') ? normalizeDecimal(String(formData.get('taxes'))) : '0';
  const securityId = formData.get('securityId') ? String(formData.get('securityId')) : undefined;
  const idempotencyKey =
    formData.get('idempotencyKey') && String(formData.get('idempotencyKey')).length >= 16
      ? String(formData.get('idempotencyKey'))
      : crypto.randomUUID();

  const parsed = transactionInputSchema.safeParse({
    portfolioId,
    type: String(formData.get('type')),
    securityId,
    settlementDate,
    quantity,
    unitPrice,
    amount,
    fees,
    taxes,
    idempotencyKey,
  });
  if (!parsed.success) throw new Error(`invalid: ${parsed.error.issues[0]?.message ?? 'input'}`);

  const { error } = await supabase.rpc('record_transaction', {
    p_portfolio_id: parsed.data.portfolioId,
    p_type: parsed.data.type,
    p_settlement_date: parsed.data.settlementDate,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_amount: parsed.data.amount ?? null,
    p_security_id: parsed.data.securityId ?? null,
    p_quantity: parsed.data.quantity ?? null,
    p_unit_price: parsed.data.unitPrice ?? null,
    p_fees: parsed.data.fees ?? '0',
    p_taxes: parsed.data.taxes ?? '0',
  });
  if (error) throw new Error(error.message);
  return portfolioId;
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    String((error as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT')
  );
}

function normalizeDecimal(value: string) {
  return value.trim().replace(',', '.');
}

function humanizeTransactionError(error: unknown, locale: 'en' | 'fr' | 'ar') {
  const message = error instanceof Error ? error.message : String(error);
  const copy = {
    en: {
      quantity: 'The sale is larger than the recorded holding for this security.',
      invalid:
        'Check the amount, quantity, price, fees, and taxes before recording this operation.',
      forbidden: 'You are not allowed to record this operation for this portfolio.',
      fallback: 'Unable to record this operation. Check the details and try again.',
    },
    fr: {
      quantity: 'La vente dépasse la quantité enregistrée pour ce titre.',
      invalid:
        'Vérifiez le montant, la quantité, le prix, les frais et les taxes avant d’enregistrer cette opération.',
      forbidden: 'Vous n’êtes pas autorisé à enregistrer cette opération pour ce portefeuille.',
      fallback: 'Impossible d’enregistrer cette opération. Vérifiez les informations et réessayez.',
    },
    ar: {
      quantity: 'البيع أكبر من الكمية المسجلة لهذا السهم.',
      invalid: 'تحقق من المبلغ والكمية والسعر والرسوم والضرائب قبل تسجيل هذه العملية.',
      forbidden: 'لا تملك صلاحية تسجيل هذه العملية لهذه المحفظة.',
      fallback: 'تعذر تسجيل هذه العملية. تحقق من التفاصيل وحاول مرة أخرى.',
    },
  }[locale];
  if (/insufficient (shares|quantity)/i.test(message)) {
    return copy.quantity;
  }
  if (/^invalid:|invalid buy\/sell|invalid amount|check constraint|violates/i.test(message)) {
    return copy.invalid;
  }
  if (/forbidden|unauthorized/i.test(message)) {
    return copy.forbidden;
  }
  return message || copy.fallback;
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
  redirect(`/${locale}/account?saved=1`);
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
  redirect(`/${locale}/account?saved=1`);
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
  redirect(`/${locale}/account?saved=1`);
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
  redirect(`/${locale}/account?saved=1`);
}
