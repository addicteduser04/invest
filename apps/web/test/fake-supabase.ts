export type RpcResult = { data?: unknown; error?: { message: string } | null };

export interface FakeSupabaseConfig {
  user: { id: string } | null;
  role: 'data_admin' | 'investor' | null;
  rpc?: Record<string, RpcResult | ((args: unknown) => RpcResult)>;
}

/** A minimal fake matching the subset of the Supabase client shape used by admin API routes:
 * auth.getUser(), from('user_roles').select().eq().eq().maybeSingle(), and rpc(). */
export function createFakeSupabase(config: FakeSupabaseConfig) {
  return {
    auth: {
      getUser: async () => ({ data: { user: config.user } }),
    },
    from: (_table: string) => ({
      select: (_columns: string) => ({
        eq: (_col1: string, _val1: unknown) => ({
          eq: (_col2: string, _val2: unknown) => ({
            maybeSingle: async () => ({
              data: config.role === 'data_admin' ? { role: 'data_admin' } : null,
            }),
          }),
        }),
      }),
    }),
    rpc: async (name: string, args?: unknown): Promise<RpcResult> => {
      const entry = config.rpc?.[name];
      if (typeof entry === 'function') return entry(args);
      if (entry) return entry;
      return { data: null, error: null };
    },
  };
}
