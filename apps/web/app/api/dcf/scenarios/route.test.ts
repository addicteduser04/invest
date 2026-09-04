import { beforeEach, describe, expect, it, vi } from 'vitest';

interface StoredScenario {
  id: string;
  user_id: string;
  security_id: string;
  name: string;
  assumptions: unknown;
  updated_at: string;
}

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  rows: [] as StoredScenario[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
    },
    from: (table: string) => {
      if (table !== 'dcf_scenarios') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (_col: string, securityId: string) => ({
            order: async () => ({
              data: state.rows
                .filter((row) => row.security_id === securityId && row.user_id === state.user?.id)
                .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
              error: null,
            }),
          }),
        }),
        upsert: (
          values: { user_id: string; security_id: string; name: string; assumptions: unknown },
        ) => ({
          select: () => ({
            single: async () => {
              const existingIndex = state.rows.findIndex(
                (row) =>
                  row.user_id === values.user_id &&
                  row.security_id === values.security_id &&
                  row.name === values.name,
              );
              const row: StoredScenario = {
                id: existingIndex >= 0 ? state.rows[existingIndex]!.id : `scenario-${state.rows.length + 1}`,
                user_id: values.user_id,
                security_id: values.security_id,
                name: values.name,
                assumptions: values.assumptions,
                updated_at: new Date().toISOString(),
              };
              if (existingIndex >= 0) state.rows[existingIndex] = row;
              else state.rows.push(row);
              return { data: row, error: null };
            },
          }),
        }),
      };
    },
  }),
}));

import { GET, POST } from './route';

const USER_A = { id: '00000000-0000-4000-8000-000000000001' };
const SECURITY_A = '00000000-0000-4000-8000-0000000000a1';

function getReq(securityId: string) {
  return new Request(`http://localhost/api/dcf/scenarios?securityId=${securityId}`);
}

function postReq(body: unknown) {
  return new Request('http://localhost/api/dcf/scenarios', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('DCF scenario persistence route', () => {
  beforeEach(() => {
    state.user = null;
    state.rows = [];
  });

  it('denies an unauthenticated GET and POST', async () => {
    expect((await GET(getReq(SECURITY_A))).status).toBe(401);
    expect((await POST(postReq({ securityId: SECURITY_A, name: 'Base', assumptions: {} }))).status).toBe(
      401,
    );
  });

  it('requires securityId, name and assumptions on POST', async () => {
    state.user = USER_A;
    expect((await POST(postReq({ name: 'Base', assumptions: {} }))).status).toBe(400);
    expect((await POST(postReq({ securityId: SECURITY_A, assumptions: {} }))).status).toBe(400);
    expect((await POST(postReq({ securityId: SECURITY_A, name: '  ' }))).status).toBe(400);
  });

  it('creates a scenario and lists it back for its owner', async () => {
    state.user = USER_A;
    const created = await POST(
      postReq({ securityId: SECURITY_A, name: 'Base case', assumptions: { wacc: 0.1 } }),
    );
    expect(created.status).toBe(200);
    const list = await GET(getReq(SECURITY_A));
    const body = (await list.json()) as { scenarios: StoredScenario[] };
    expect(body.scenarios).toHaveLength(1);
    expect(body.scenarios[0]!.name).toBe('Base case');
  });

  it('upserts (overwrites) when saving the same name again rather than duplicating', async () => {
    state.user = USER_A;
    await POST(postReq({ securityId: SECURITY_A, name: 'Base case', assumptions: { wacc: 0.1 } }));
    await POST(postReq({ securityId: SECURITY_A, name: 'Base case', assumptions: { wacc: 0.12 } }));
    const list = await GET(getReq(SECURITY_A));
    const body = (await list.json()) as { scenarios: StoredScenario[] };
    expect(body.scenarios).toHaveLength(1);
    expect(body.scenarios[0]!.assumptions).toEqual({ wacc: 0.12 });
  });

  it("never returns another user's scenarios from GET", async () => {
    state.user = USER_A;
    await POST(postReq({ securityId: SECURITY_A, name: 'Mine', assumptions: {} }));
    state.user = { id: '00000000-0000-4000-8000-000000000002' };
    const list = await GET(getReq(SECURITY_A));
    const body = (await list.json()) as { scenarios: StoredScenario[] };
    expect(body.scenarios).toEqual([]);
  });
});
