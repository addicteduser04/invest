import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function Page() {
  const cookieStore = await cookies();
  const saved = cookieStore.get('saif_locale')?.value;
  redirect(saved === 'en' || saved === 'ar' ? `/${saved}` : '/fr');
}
