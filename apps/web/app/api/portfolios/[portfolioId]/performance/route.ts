import { localizeError, localeSchema } from '@bvc/contracts';
import { readPortfolioPerformance } from '@/lib/portfolio-read';
import { parseDateOnlyEndOfDay } from '@/lib/dates';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ portfolioId: string }> },
) {
  const url = new URL(request.url);
  const parsedLocale = localeSchema.safeParse(url.searchParams.get('locale'));
  const locale = parsedLocale.success ? parsedLocale.data : 'fr';
  const requestedTo = url.searchParams.get('to');
  const requestedFrom = url.searchParams.get('from');
  const to = requestedTo ? parseDateOnlyEndOfDay(requestedTo) : new Date();
  const from = requestedFrom ? parseDateOnlyEndOfDay(requestedFrom) : undefined;
  if (!to || (requestedFrom && !from) || (from && from > to)) {
    return Response.json(
      { code: 'INVALID_DATE', message: localizeError({ code: 'INVALID_DATE' }, locale) },
      { status: 422 },
    );
  }
  const { portfolioId } = await params;
  try {
    const result = await readPortfolioPerformance(portfolioId, to, from ?? undefined);
    if (result.status === 'unauthenticated') {
      return Response.json(
        { code: 'UNAUTHENTICATED', message: localizeError({ code: 'UNAUTHENTICATED' }, locale) },
        { status: 401 },
      );
    }
    if (result.status === 'forbidden') {
      return Response.json(
        {
          code: 'FORBIDDEN_PORTFOLIO',
          message: localizeError({ code: 'FORBIDDEN_PORTFOLIO' }, locale),
        },
        { status: 403 },
      );
    }
    return Response.json(result.performance, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json(
      { code: 'INTERNAL_FAILURE', message: localizeError({ code: 'INTERNAL_FAILURE' }, locale) },
      { status: 500 },
    );
  }
}
