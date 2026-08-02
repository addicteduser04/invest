import { login } from '../auth-actions';
export default async function Login({ params }: { params: Promise<{ locale: string }> }) {
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
        <h1>{ar ? 'تسجيل الدخول' : 'Connexion'}</h1>
        <form className="form" action={login}>
          <input type="hidden" name="locale" value={locale} />
          <label>
            E-mail
            <input required name="email" type="email" autoComplete="email" />
          </label>
          <label>
            {ar ? 'كلمة المرور' : 'Mot de passe'}
            <input required name="password" type="password" autoComplete="current-password" />
          </label>
          <button className="button" type="submit">
            {ar ? 'الدخول' : 'Se connecter'}
          </button>
        </form>
      </section>
    </main>
  );
}
