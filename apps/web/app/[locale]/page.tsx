import fr from '../../messages/fr.json';
import ar from '../../messages/ar.json';
const data = {
  cash: '85 437,25 MAD',
  securities: '16 500,00 MAD',
  total: '101 937,25 MAD',
  gain: '+1 937,25 MAD',
};
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === 'ar';
  const t = isAr ? ar : fr;
  return (
    <main className="shell" dir={isAr ? 'rtl' : 'ltr'}>
      <nav className="nav">
        <span className="brand">{t.brand}</span>
        <span className="pill">{t.synthetic}</span>
      </nav>
      <section className="hero">
        <h1>{t.welcome}</h1>
        <p>{t.subtitle}</p>
        <div className="actions">
          <a className="button" href={`/${locale}/register`}>
            {t.register}
          </a>
          <a className="button secondary" href={`/${locale}/login`}>
            {t.login}
          </a>
        </div>
      </section>
      <section aria-labelledby="portfolio">
        <h2 id="portfolio">{t.portfolio}</h2>
        <p className="label">{t.freshness}</p>
        <div className="grid">
          {(
            [
              [t.total, data.total],
              [t.cash, data.cash],
              [t.securities, data.securities],
              [t.gain, data.gain],
            ] as const
          ).map(([label, value]) => (
            <article className="card" key={label}>
              <div className="label">{label}</div>
              <div className="amount">{value}</div>
            </article>
          ))}
        </div>
        <article className="card panel">
          <h3>{t.positions}</h3>
          <table className="table">
            <thead>
              <tr>
                <th>{t.ticker}</th>
                <th>{t.quantity}</th>
                <th>{t.price}</th>
                <th>{t.value}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>SYN-IAM</td>
                <td>150</td>
                <td>110,00 MAD</td>
                <td>16 500,00 MAD</td>
              </tr>
            </tbody>
          </table>
        </article>
      </section>
      <footer>{t.synthetic}</footer>
    </main>
  );
}
