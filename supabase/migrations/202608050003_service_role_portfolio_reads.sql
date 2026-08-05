begin;

grant usage on schema public to service_role;
grant select on public.profiles, public.user_roles, public.portfolios, public.transactions to service_role;

commit;
