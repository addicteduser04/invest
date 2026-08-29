import { asLocale } from '@/lib/i18n';
import { readPortfolioPerformance, readPortfolioValuation } from '@/lib/portfolio-read';

const fallbackSummary = ({
  locale,
  status,
  largestWeight,
  totalGain,
}: {
  locale: 'en' | 'fr' | 'ar';
  status: string;
  largestWeight: number;
  totalGain: string;
}) => {
  if (locale === 'fr') {
    if (status === 'missing')
      return 'Certains cours manquent : la valorisation et les métriques de performance doivent être interprétées comme incomplètes.';
    if (status === 'stale')
      return 'Certaines positions reposent sur des cours anciens. Vérifiez la fraîcheur des données avant d’interpréter la performance.';
    if (largestWeight >= 35)
      return `La concentration est le principal point d’attention : la plus grande position représente environ ${largestWeight.toFixed(1)} % de la valeur du portefeuille.`;
    return `La valorisation est complète. Le P&L total calculé est de ${totalGain} MAD et aucune position ne dépasse actuellement 35 % de la valeur du portefeuille.`;
  }
  if (locale === 'ar') {
    if (status === 'missing')
      return 'بعض أسعار السوق مفقودة، لذلك يجب اعتبار التقييم ومقاييس الأداء غير مكتملة.';
    if (status === 'stale')
      return 'تعتمد بعض المراكز على أسعار قديمة. تحقّق من حداثة البيانات قبل تفسير الأداء.';
    if (largestWeight >= 35)
      return `التركيز هو أبرز نقطة للمراقبة: يمثل أكبر مركز نحو ${largestWeight.toFixed(1)}٪ من قيمة المحفظة.`;
    return `التقييم مكتمل. إجمالي الربح/الخسارة المحسوب هو ${totalGain} درهم، ولا يتجاوز أي مركز حالياً 35٪ من قيمة المحفظة.`;
  }
  if (status === 'missing')
    return 'Some market prices are missing, so valuation and performance metrics should be treated as incomplete.';
  if (status === 'stale')
    return 'Some holdings rely on stale prices. Check data freshness before interpreting performance.';
  if (largestWeight >= 35)
    return `Concentration is the main point to monitor: the largest position represents about ${largestWeight.toFixed(1)}% of portfolio value.`;
  return `Valuation is complete. Calculated total P&L is ${totalGain} MAD and no single position currently exceeds 35% of portfolio value.`;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ portfolioId: string }> },
) {
  const { portfolioId } = await params;
  const body: unknown = await request.json().catch(() => ({}));
  const requestedLocale =
    body && typeof body === 'object' && 'locale' in body ? String(body.locale) : 'fr';
  const locale = asLocale(requestedLocale);
  const [valuationResult, performanceResult] = await Promise.all([
    readPortfolioValuation(portfolioId),
    readPortfolioPerformance(portfolioId),
  ]);
  if (
    valuationResult.status === 'unauthenticated' ||
    performanceResult.status === 'unauthenticated'
  )
    return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  if (valuationResult.status !== 'ok' || performanceResult.status !== 'ok')
    return Response.json({ error: 'FORBIDDEN_PORTFOLIO' }, { status: 403 });

  const valuation = valuationResult.valuation;
  const performance = performanceResult.performance;
  const openPositions = valuation.positions.filter((position) => position.quantity !== '0');
  const largestWeight = openPositions.reduce(
    (maximum, position) => Math.max(maximum, Number(position.weightPercent ?? '0')),
    0,
  );
  const deterministic = fallbackSummary({
    locale,
    status: valuation.status,
    largestWeight,
    totalGain: valuation.totalGain,
  });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return Response.json({ summary: deterministic, provider: 'deterministic' });

  const endpoint = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
  const payload = {
    valuationDate: valuation.valuationDate,
    status: valuation.status,
    totalValue: valuation.totalValue,
    cashValue: valuation.cashValue,
    securitiesValue: valuation.securitiesValue,
    totalGain: valuation.totalGain,
    realizedGain: valuation.realizedGain,
    unrealizedGain: valuation.unrealizedGain,
    netDividendIncome: valuation.netDividendIncome,
    twr: performance.twr,
    xirr: performance.xirr,
    holdings: openPositions.map((position) => ({
      ticker: position.ticker,
      sector: position.sector,
      weightPercent: position.weightPercent,
      unrealizedGain: position.unrealizedGain,
      priceStatus: position.priceStatus,
    })),
  };
  const language = locale === 'ar' ? 'Arabic' : locale === 'fr' ? 'French' : 'English';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: `You explain portfolio analytics in ${language}. Use only supplied numbers. Do not predict prices, invent market facts, or give buy/sell/hold recommendations. Produce at most three concise bullets and explicitly flag missing/stale data.`,
          },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return Response.json({ summary: deterministic, provider: 'deterministic' });
    const parsed = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const summary = parsed.choices?.[0]?.message?.content?.trim();
    return Response.json({
      summary: summary || deterministic,
      provider: summary ? 'deepseek' : 'deterministic',
    });
  } catch {
    return Response.json({ summary: deterministic, provider: 'deterministic' });
  }
}
