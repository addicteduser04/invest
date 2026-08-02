import { register } from '../auth-actions';
export default async function Register({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ar = locale === 'ar';
  return (
    <main className="shell" dir={ar ? 'rtl' : 'ltr'}>
      <nav className="nav">
        <a className="brand" href={`/${locale}`}>
          BVC Portfolio
        </a>
      </nav>
      <section className="card">
        <h1>{ar ? 'إنشاء حساب' : 'Créer un compte'}</h1>
        <form className="form" action={register}>
          <input type="hidden" name="locale" value={locale} />
          <label>
            {ar ? 'الاسم' : 'Nom'}
            <input required name="displayName" autoComplete="name" />
          </label>
          <label>
            {ar ? 'البريد الإلكتروني' : 'E-mail'}
            <input required name="email" type="email" autoComplete="email" />
          </label>
          <label>
            {ar ? 'كلمة المرور' : 'Mot de passe'}
            <input
              required
              name="password"
              type="password"
              minLength={10}
              autoComplete="new-password"
            />
          </label>
          <button className="button" type="submit">
            {ar ? 'إنشاء الحساب' : 'Créer le compte'}
          </button>
        </form>
      </section>
    </main>
  );
}
