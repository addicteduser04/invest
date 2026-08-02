export default async function ImportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const ar = locale === 'ar';
  return (
    <main className="shell" dir={ar ? 'rtl' : 'ltr'}>
      <nav className="nav">
        <span className="brand">BVC Portfolio</span>
        <span className="pill">Admin data</span>
      </nav>
      <section className="card">
        <h1>{ar ? 'استيراد أسعار CSV' : 'Import CSV des cours'}</h1>
        <p className="notice">
          {ar
            ? 'خاص بالبيانات الاصطناعية أو الملفات المرخّصة للاختبار. لا يتم نشر أي ملف تلقائياً.'
            : 'Réservé aux données synthétiques ou autorisées pour le pilote. Aucun fichier n’est publié automatiquement.'}
        </p>
        <form
          className="form"
          action="/api/admin/imports/preview"
          method="post"
          encType="multipart/form-data"
        >
          <label>
            {ar ? 'ملف CSV الأصلي' : 'Fichier CSV original'}
            <input required type="file" name="file" accept=".csv,text/csv" />
          </label>
          <label>
            {ar ? 'عمود التاريخ' : 'Colonne date'}
            <input name="date" defaultValue="time" />
          </label>
          <label>
            Ticker
            <input name="ticker" defaultValue="symbol" />
          </label>
          <label>
            Close
            <input name="close" defaultValue="close" />
          </label>
          <button className="button">{ar ? 'معاينة والتحقق' : 'Prévisualiser et valider'}</button>
        </form>
        <p>
          {ar
            ? 'يلزم اعتماد مسؤول بيانات ثانٍ قبل النشر.'
            : 'Un second administrateur données doit approuver explicitement avant publication.'}
        </p>
      </section>
    </main>
  );
}
