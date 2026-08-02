'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function register(formData: FormData) {
  const locale = formData.get('locale') === 'ar' ? 'ar' : 'fr';
  const email = String(formData.get('email'));
  const password = String(formData.get('password'));
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { locale, display_name: String(formData.get('displayName') ?? '') } },
  });
  if (error) throw new Error(error.message);
  redirect(`/${locale}/dashboard`);
}
export async function login(formData: FormData) {
  const locale = formData.get('locale') === 'ar' ? 'ar' : 'fr';
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get('email')),
    password: String(formData.get('password')),
  });
  if (error) throw new Error('Authentication failed');
  redirect(`/${locale}/dashboard`);
}
export async function createPortfolio(formData: FormData) {
  const locale = formData.get('locale') === 'ar' ? 'ar' : 'fr';
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const { error } = await supabase
    .from('portfolios')
    .insert({ owner_id: user.id, name: String(formData.get('name')), base_currency: 'MAD' });
  if (error) throw new Error(error.message);
  redirect(`/${locale}/dashboard`);
}
export async function addTransaction(formData: FormData) {
  const locale = formData.get('locale') === 'ar' ? 'ar' : 'fr';
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const type = String(formData.get('type'));
  const amount = formData.get('amount') ? String(formData.get('amount')) : null;
  const portfolioId = String(formData.get('portfolioId'));
  const { error } = await supabase.rpc('record_transaction', {
    p_portfolio_id: portfolioId,
    p_type: type,
    p_settlement_date: new Date().toISOString().slice(0, 10),
    p_idempotency_key: crypto.randomUUID(),
    p_amount: amount,
    p_security_id: formData.get('securityId') ? String(formData.get('securityId')) : null,
    p_quantity: formData.get('quantity') ? String(formData.get('quantity')) : null,
    p_unit_price: formData.get('unitPrice') ? String(formData.get('unitPrice')) : null,
    p_fees: formData.get('fees') ? String(formData.get('fees')) : '0',
    p_taxes: formData.get('taxes') ? String(formData.get('taxes')) : '0',
  });
  if (error) throw new Error(error.message);
  redirect(`/${locale}/dashboard`);
}
