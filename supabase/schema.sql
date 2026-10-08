-- ============================================================
-- Ma Boutique — schéma Supabase (PostgreSQL) + Row Level Security
-- Exécuter dans l'éditeur SQL de ton projet Supabase.
-- ============================================================

create extension if not exists "pgcrypto";

-- Colonnes évolutives : ajoutées tôt pour que les vues/fonctions
-- ci-dessous restent rejouables même sur une base vide ou partielle.
-- (doublons avec la section v2 plus bas : IF NOT EXISTS = sans risque)

-- Chaque table porte un user_id (défaut = utilisateur connecté)
-- afin de pouvoir appliquer une RLS simple : chaque utilisateur
-- ne voit et ne modifie que ses propres données.

create table if not exists shops (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists items (
  id text primary key,
  shop_id text not null references shops (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  cost_price numeric not null default 0,
  price numeric not null default 0,
  stock integer not null default 0,
  low_stock_threshold integer not null default 5,
  opening_stock integer not null default 0,
  opening_cost numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists restocks (
  id text primary key,
  item_id text not null references items (id) on delete cascade,
  shop_id text not null references shops (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  quantity integer not null,
  unit_cost numeric not null,
  restock_date date not null,
  supplier text,
  created_at timestamptz not null default now()
);

create table if not exists customers (
  id text primary key,
  shop_id text not null references shops (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  phone text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists sales (
  id text primary key,
  shop_id text not null references shops (id) on delete cascade,
  item_id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_name text not null,
  quantity integer not null,
  unit_price numeric not null,
  unit_cost numeric not null,
  payment_type text not null check (payment_type in ('comptant', 'crédit')),
  customer_id text,
  sale_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists credits (
  id text primary key,
  shop_id text not null references shops (id) on delete cascade,
  customer_id text not null,
  sale_id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  total_amount numeric not null,
  amount_paid numeric not null default 0,
  due_date date,
  status text not null default 'en cours'
    check (status in ('en cours', 'partiellement payé', 'soldé', 'en retard')),
  sale_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists credit_payments (
  id text primary key,
  credit_id text not null references credits (id) on delete cascade,
  shop_id text not null references shops (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount numeric not null,
  payment_date date not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists stock_movements (
  id text primary key,
  item_id text not null,
  shop_id text not null references shops (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null check (type in ('vente', 'réappro', 'ajustement', 'annulation')),
  quantity integer not null,
  stock_before integer not null,
  stock_after integer not null,
  ref_id text,
  created_at timestamptz not null default now()
);

-- Colonnes évolutives (v2) appliquées tôt : les vues/fonctions ci-dessous
-- référencent cancelled_at / deleted_at, elles doivent exister avant.
alter table shops    add column if not exists deleted_at timestamptz;
alter table items    add column if not exists deleted_at timestamptz;
alter table customers add column if not exists deleted_at timestamptz;
alter table customers add column if not exists anonymized boolean not null default false;
alter table sales add column if not exists cancelled_at timestamptz;

create index if not exists items_shop_idx on items (shop_id);
create index if not exists sales_shop_date_idx on sales (shop_id, sale_date);
create index if not exists sales_item_idx on sales (item_id);
create index if not exists restocks_item_idx on restocks (item_id, restock_date);
create index if not exists credits_shop_idx on credits (shop_id, status);
create index if not exists credit_payments_credit_idx on credit_payments (credit_id);
create index if not exists stock_movements_item_idx on stock_movements (item_id);

-- ============================================================
-- Row Level Security : chaque utilisateur ne voit que ses données
-- ============================================================

alter table shops enable row level security;
alter table items enable row level security;
alter table restocks enable row level security;
alter table customers enable row level security;
alter table sales enable row level security;
alter table credits enable row level security;
alter table credit_payments enable row level security;
alter table stock_movements enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['shops', 'items', 'restocks', 'customers', 'sales', 'credits', 'credit_payments', 'stock_movements']
  loop
    execute format(
      'drop policy if exists "own rows" on %I', t);
    execute format(
      'create policy "own rows" on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t);
  end loop;
end $$;

-- ============================================================
-- Vues et fonctions de calcul
-- (security_invoker : les vues respectent la RLS de l'utilisateur)
-- ============================================================

-- Bénéfices et chiffre d'affaires calculés côté base
-- (vue « owner » : remplacée plus bas par la version masquée pour le vendeur)
create or replace view v_sales as
select
  s.*,
  (s.unit_price - s.unit_cost) * s.quantity as profit,
  s.unit_price * s.quantity as revenue,
  (s.sale_date - current_date) as days_since_sale
from sales s;

-- Statut et reste à payer recalculés à la volée
create or replace view v_credits
with (security_invoker = true) as
select
  c.*,
  (c.total_amount - c.amount_paid) as rest_to_pay,
  case
    when c.amount_paid >= c.total_amount then 'soldé'
    when c.due_date is not null and c.due_date < current_date then 'en retard'
    when c.amount_paid > 0 then 'partiellement payé'
    else 'en cours'
  end as computed_status
from credits c;

-- Coût moyen pondéré d'un article, recalculé en rejouant ses événements
-- (identique à la formule de l'application, avec remise à zéro si stock = 0)
create or replace function compute_avg_cost(p_item_id text)
returns table (stock integer, avg_cost numeric)
language plpgsql
security invoker
as $$
declare
  v_qty integer;
  v_cost numeric;
  ev record;
begin
  select i.opening_stock, i.opening_cost
    into v_qty, v_cost
    from items i
   where i.id = p_item_id;

  if not found then
    return;
  end if;

  for ev in
    select 'r'::text as kind,
           r.restock_date::text as d,
           r.created_at,
           r.quantity,
           r.unit_cost
      from restocks r
     where r.item_id = p_item_id
    union all
    select 's'::text,
           s.sale_date::text,
           s.created_at,
           s.quantity,
           null::numeric
      from sales s
     where s.item_id = p_item_id
       and s.cancelled_at is null
     order by d, case when kind = 'r' then 0 else 1 end, created_at
  loop
    if ev.kind = 'r' then
      if v_qty <= 0 then
        v_cost := ev.unit_cost;
      else
        v_cost := (v_qty * v_cost + ev.quantity * ev.unit_cost) / (v_qty + ev.quantity);
      end if;
      v_qty := v_qty + ev.quantity;
    else
      v_qty := greatest(0, v_qty - ev.quantity);
    end if;
  end loop;

  return query select v_qty, round(v_cost, 4);
end;
$$;

-- Résumé d'une période : chiffre d'affaires, bénéfice, dépenses, ventes
create or replace function period_summary(p_from date, p_to date)
returns table (revenue numeric, profit numeric, spent numeric, sales_count bigint)
language sql
security invoker
as $$
  select
    coalesce(sum(v.revenue), 0)::numeric,
    coalesce(sum(v.profit), 0)::numeric,
    coalesce((select sum(r.quantity * r.unit_cost)
                from restocks r
               where r.restock_date >= p_from and r.restock_date < p_to), 0)::numeric,
    count(*)::bigint
  from v_sales v
  where v.sale_date >= p_from and v.sale_date < p_to;
$$;

-- ============================================================
-- v2 — RÔLES, MEMBRES ET PERMISSIONS EN BASE (RLS)
-- ============================================================

-- Colonnes de suppression douce + anonymisation RGPD
alter table shops    add column if not exists deleted_at timestamptz;
alter table items    add column if not exists deleted_at timestamptz;
alter table customers add column if not exists deleted_at timestamptz;
alter table customers add column if not exists anonymized boolean not null default false;
-- Annulation douce d'une vente : doit exister avant les vues v_sales / get_sales
alter table sales add column if not exists cancelled_at timestamptz;

-- Journal d'audit : jamais modifiable (aucune policy update/delete)
create table if not exists audit_log (
  id text primary key,
  shop_id text references shops (id) on delete cascade,
  action text not null,
  target text not null,
  details text,
  author text not null,
  created_at timestamptz not null default now()
);

-- Membres d'une boutique : source de vérité des accès
-- (user_id rempli à l'acceptation de l'invitation ; invite par e-mail sinon)
create table if not exists shop_members (
  id text primary key,
  shop_id text not null references shops (id) on delete cascade,
  user_id text,
  email text not null,
  role text not null check (role in ('proprietaire', 'gerant', 'vendeur')),
  created_at timestamptz not null default now(),
  unique (shop_id, email)
);

create index if not exists shop_members_shop_idx on shop_members (shop_id);
create index if not exists shop_members_user_idx on shop_members (user_id);
create index if not exists audit_log_shop_idx on audit_log (shop_id, created_at);
create index if not exists sales_date_idx on sales (sale_date);
create index if not exists customers_shop_idx on customers (shop_id);

alter table shop_members enable row level security;
alter table audit_log enable row level security;

-- Rôle de l'utilisateur courant sur une boutique (security definer :
-- évite la récursion RLS sur shops/shop_members, filtre toujours par auth.uid())
create or replace function my_shop_role(p_shop_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from shops s where s.id = p_shop_id and s.user_id = auth.uid())
      then 'proprietaire'
    else (
      select m.role from shop_members m
       where m.shop_id = p_shop_id
         and (
           m.user_id = auth.uid()::text
           -- Invitation par e-mail : reconnu à la connexion même si
           -- user_id est encore vide (invité avant création de compte)
           or exists (
             select 1 from auth.users u
              where u.id = auth.uid()
                and lower(u.email) = lower(m.email)
           )
         )
      limit 1
    )
  end;
$$;

-- Vrai si le rôle courant atteint au minimum p_min
create or replace function role_at_least(p_role text, p_min text)
returns boolean
language sql
immutable
as $$
  select coalesce(case p_role
    when 'vendeur' then 1
    when 'gerant' then 2
    when 'proprietaire' then 3
    else 0 end, 0) >= case p_min
    when 'vendeur' then 1
    when 'gerant' then 2
    when 'proprietaire' then 3
    else 99 end;
$$;

grant execute on function my_shop_role(text), role_at_least(text, text) to authenticated;

-- ----------------------------------------------------------
-- Politiques par rôle (remplace la boucle "own rows")
-- ----------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['shops', 'items', 'restocks', 'customers', 'sales', 'credits', 'credit_payments', 'stock_movements']
  loop
    execute format('drop policy if exists "own rows" on %I', t);
    execute format('drop policy if exists "membres lecture" on %I', t);
    execute format('drop policy if exists "membres ecriture" on %I', t);
    execute format('drop policy if exists "membres insert" on %I', t);
    execute format('drop policy if exists "membres maj" on %I', t);
    execute format('drop policy if exists "membres suppression" on %I', t);
    execute format('drop policy if exists "proprietaire maj" on %I', t);
    execute format('drop policy if exists "proprietaire suppression" on %I', t);
  end loop;
end $$;

-- Lecture : tout membre voit les lignes de sa boutique
-- (crédits réservés aux gérants/propriétaires)
do $$
declare t text;
begin
  foreach t in array array['items', 'restocks', 'customers', 'sales', 'stock_movements']
  loop
    execute format(
      'create policy "membres lecture" on %I for select using (my_shop_role(shop_id) is not null)', t);
  end loop;
end $$;

drop policy if exists "membres lecture" on credits;
drop policy if exists "membres lecture" on credit_payments;
create policy "membres lecture" on credits for select
  using (role_at_least(my_shop_role(shop_id), 'gerant'));
create policy "membres lecture" on credit_payments for select
  using (role_at_least(my_shop_role(shop_id), 'gerant'));

-- Écriture : le vendeur ne saisit que des ventes ; gérant+ gère le reste
do $$
declare t text;
begin
  foreach t in array array['restocks', 'customers', 'credit_payments', 'credits']
  loop
    execute format(
      'create policy "membres insert" on %I for insert with check (role_at_least(my_shop_role(shop_id), ''gerant''))', t);
    execute format(
      'create policy "membres maj" on %I for update using (role_at_least(my_shop_role(shop_id), ''gerant'')) with check (role_at_least(my_shop_role(shop_id), ''gerant''))', t);
  end loop;
end $$;

-- Articles : gérant+ crée/corrige ; toute modification de stock passe par les RPC
drop policy if exists "membres ecriture" on items;
drop policy if exists "membres insert" on items;
drop policy if exists "membres maj" on items;
create policy "membres insert" on items for insert
  with check (role_at_least(my_shop_role(shop_id), 'gerant'));
create policy "membres maj" on items for update
  using (role_at_least(my_shop_role(shop_id), 'gerant'))
  with check (role_at_least(my_shop_role(shop_id), 'gerant'));

-- Ventes : tout membre peut enregistrer une vente ; seul gérant+ peut corriger
drop policy if exists "membres ecriture" on sales;
drop policy if exists "membres insert" on sales;
drop policy if exists "membres maj" on sales;
create policy "membres insert" on sales for insert
  with check (my_shop_role(shop_id) is not null);
create policy "membres maj" on sales for update
  using (role_at_least(my_shop_role(shop_id), 'gerant'))
  with check (role_at_least(my_shop_role(shop_id), 'gerant'));

-- Mouvements de stock : créés par les RPC, modifiables par gérant+
drop policy if exists "membres ecriture" on stock_movements;
drop policy if exists "membres insert" on stock_movements;
drop policy if exists "membres maj" on stock_movements;
create policy "membres insert" on stock_movements for insert
  with check (my_shop_role(shop_id) is not null);
create policy "membres maj" on stock_movements for update
  using (role_at_least(my_shop_role(shop_id), 'gerant'))
  with check (role_at_least(my_shop_role(shop_id), 'gerant'));

-- Boutiques : lecture membres, création par le propriétaire,
-- modification/suppression réservées au propriétaire (jamais de delete
-- de ventes/clients/articles : uniquement des mises à jour soft delete)
drop policy if exists "membres lecture" on shops;
drop policy if exists "membres ecriture" on shops;
drop policy if exists "membres insert" on shops;
drop policy if exists "proprietaire maj" on shops;
create policy "membres lecture" on shops for select
  using (my_shop_role(id) is not null);
create policy "membres insert" on shops for insert
  with check (user_id = auth.uid());
create policy "proprietaire maj" on shops for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Pas de policy delete sur sales/credits/credit_payments/items/customers
-- : les suppressions définitives de ces tables sont interdites en base.
drop policy if exists "membres suppression" on restocks;
drop policy if exists "membres suppression" on stock_movements;
drop policy if exists "proprietaire suppression" on shops;
create policy "membres suppression" on restocks for delete
  using (role_at_least(my_shop_role(shop_id), 'gerant'));
create policy "membres suppression" on stock_movements for delete
  using (role_at_least(my_shop_role(shop_id), 'gerant'));
create policy "proprietaire suppression" on shops for delete
  using (user_id = auth.uid());

-- shop_members : visible par les membres, géré par le propriétaire
drop policy if exists "lecture membres" on shop_members;
drop policy if exists "proprietaire invite" on shop_members;
drop policy if exists "proprietaire modifie" on shop_members;
drop policy if exists "proprietaire retire" on shop_members;
create policy "lecture membres" on shop_members for select
  using (
    shop_id in (select s.id from shops s where s.user_id = auth.uid())
    or my_shop_role(shop_id) is not null
  );
create policy "proprietaire invite" on shop_members for insert
  with check (my_shop_role(shop_id) = 'proprietaire');
create policy "proprietaire modifie" on shop_members for update
  using (my_shop_role(shop_id) = 'proprietaire')
  with check (my_shop_role(shop_id) = 'proprietaire');
create policy "proprietaire retire" on shop_members for delete
  using (my_shop_role(shop_id) = 'proprietaire');

-- audit_log : lecture gérant+, écriture par les membres, JAMAIS modifiable
drop policy if exists "lecture audit" on audit_log;
drop policy if exists "ecriture audit" on audit_log;
create policy "lecture audit" on audit_log for select
  using (
    (shop_id is not null and role_at_least(my_shop_role(shop_id), 'gerant'))
    or (shop_id is null and exists (select 1 from shops s where s.user_id = auth.uid()))
  );
create policy "ecriture audit" on audit_log for insert
  with check (
    (shop_id is not null and my_shop_role(shop_id) is not null)
    or (shop_id is null and exists (select 1 from shops s where s.user_id = auth.uid()))
  );

-- ----------------------------------------------------------
-- Masquage des prix d'achat pour le vendeur (côté base)
-- Les colonnes de coût sont retirées des grants directs ;
-- get_items()/get_sales() les rendent masqués (null) aux vendeurs
-- et complets aux gérants/propriétaires.
-- ----------------------------------------------------------

revoke select on items from anon, authenticated;
revoke select on sales from anon, authenticated;
grant select (
  id, shop_id, user_id, name, price, stock, low_stock_threshold,
  opening_stock, created_at, deleted_at
) on items to authenticated;
grant select (
  id, shop_id, user_id, item_id, item_name, quantity, unit_price,
  payment_type, customer_id, sale_date, created_at
) on sales to authenticated;

-- Vue de calcul : le coût et le bénéfice ne sont révélés qu'aux
-- gérants/propriétaires. Vue « owner » (security definer implicite) :
-- les colonnes de coût ne sont plus accordées aux utilisateurs, donc une
-- vue security_invoker ne pourrait plus être lue par personne. Les lignes
-- sont filtrées à la main (my_shop_role) puisque la RLS est contournée.
drop view if exists v_sales cascade;
create view v_sales as
select
  s.id,
  s.shop_id,
  s.item_id,
  s.user_id,
  s.item_name,
  s.quantity,
  s.unit_price,
  case when role_at_least(my_shop_role(s.shop_id), 'gerant') then s.unit_cost else null end as unit_cost,
  s.payment_type,
  s.customer_id,
  s.sale_date,
  s.created_at,
  case when role_at_least(my_shop_role(s.shop_id), 'gerant')
       then (s.unit_price - s.unit_cost) * s.quantity else null end as profit,
  s.unit_price * s.quantity as revenue,
  (s.sale_date - current_date) as days_since_sale
from sales s
where my_shop_role(s.shop_id) is not null
  -- Les ventes annulées restent en base (traçabilité) mais ne comptent plus
  and s.cancelled_at is null;

grant select on v_sales to authenticated;
-- v_credits reste security_invoker : la RLS sur credits (gerant+) fait
-- le filtrage, les colonnes ne sont pas masquées.
grant select on v_credits to authenticated;

-- Accès complet aux coûts (gérant/propriétaire uniquement)
create or replace function get_items()
returns setof items
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.shop_id, i.user_id, i.name,
         case when role_at_least(my_shop_role(i.shop_id), 'gerant') then i.cost_price else null end as cost_price,
         i.price, i.stock, i.low_stock_threshold,
         i.opening_stock,
         case when role_at_least(my_shop_role(i.shop_id), 'gerant') then i.opening_cost else null end as opening_cost,
         i.created_at, i.deleted_at
    from items i
   where my_shop_role(i.shop_id) is not null
   order by i.created_at;
$$;

create or replace function get_sales()
returns setof sales
language sql
stable
security definer
set search_path = public
as $$
  -- Ordre des colonnes identique à la table sales (retour setof sales)
  select s.id, s.shop_id, s.item_id, s.user_id, s.item_name, s.quantity, s.unit_price,
         case when role_at_least(my_shop_role(s.shop_id), 'gerant') then s.unit_cost else null end as unit_cost,
         s.payment_type, s.customer_id, s.sale_date, s.created_at, s.cancelled_at
    from sales s
   where my_shop_role(s.shop_id) is not null
     and s.cancelled_at is null
   order by s.sale_date desc, s.created_at desc;
$$;

grant execute on function get_items(), get_sales() to authenticated;

-- Restocks : le coût d'achat unitaire est retiré du grant direct
-- (masqué pour les vendeurs) ; get_restocks() le rend nul pour eux.
revoke select on restocks from anon, authenticated;
grant select (
  id, item_id, shop_id, user_id, quantity, restock_date, supplier, created_at
) on restocks to authenticated;

create or replace function get_restocks()
returns setof restocks
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.item_id, r.shop_id, r.user_id, r.quantity,
         case when role_at_least(my_shop_role(r.shop_id), 'gerant')
              then r.unit_cost else null end as unit_cost,
         r.restock_date, r.supplier, r.created_at
    from restocks r
   where my_shop_role(r.shop_id) is not null
   order by r.restock_date desc, r.created_at desc;
$$;

grant execute on function get_restocks() to authenticated;

-- compute_avg_cost passe en security definer (les colonnes de coût
-- des articles/restocks/ventes ne sont plus lisibles directement) :
-- le stock est recalculé pour tout membre, le coût n'est renvoyé
-- qu'aux gérants/propriétaires (null pour un vendeur).
create or replace function compute_avg_cost(p_item_id text)
returns table (stock integer, avg_cost numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty integer;
  v_cost numeric;
  v_role text;
  ev record;
begin
  select i.opening_stock, i.opening_cost, my_shop_role(i.shop_id)
    into v_qty, v_cost, v_role
    from items i
   where i.id = p_item_id;

  if v_qty is null or v_role is null then
    return;
  end if;

  for ev in
    select 'r'::text as kind,
           r.restock_date::text as d,
           r.created_at,
           r.quantity,
           r.unit_cost
      from restocks r
     where r.item_id = p_item_id
    union all
    select 's'::text,
           s.sale_date::text,
           s.created_at,
           s.quantity,
           null::numeric
      from sales s
     where s.item_id = p_item_id
       and s.cancelled_at is null
     order by d, case when kind = 'r' then 0 else 1 end, created_at
  loop
    if ev.kind = 'r' then
      if v_qty <= 0 then
        v_cost := ev.unit_cost;
      else
        v_cost := (v_qty * v_cost + ev.quantity * ev.unit_cost) / (v_qty + ev.quantity);
      end if;
      v_qty := v_qty + ev.quantity;
    else
      v_qty := greatest(0, v_qty - ev.quantity);
    end if;
  end loop;

  return query
    select v_qty,
           case when role_at_least(v_role, 'gerant')
                then round(v_cost, 4) else null end;
end;
$$;

grant execute on function compute_avg_cost(text) to authenticated;

-- compute_avg_cost / period_summary doivent lire les colonnes masquées :
-- on les passe en security definer avec contrôle de rôle explicite.
create or replace function period_summary(p_from date, p_to date)
returns table (revenue numeric, profit numeric, spent numeric, sales_count bigint)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(s.unit_price * s.quantity), 0)::numeric,
    coalesce(sum(case when role_at_least(my_shop_role(s.shop_id), 'gerant')
                      then (s.unit_price - s.unit_cost) * s.quantity else 0 end), 0)::numeric,
    coalesce((select sum(r.quantity * r.unit_cost)
                from restocks r
               where r.restock_date >= p_from and r.restock_date < p_to
                 and role_at_least(my_shop_role(r.shop_id), 'gerant')), 0)::numeric,
    count(*)::bigint
  from sales s
  where s.sale_date >= p_from and s.sale_date < p_to
    and s.cancelled_at is null
    and my_shop_role(s.shop_id) is not null;
$$;

-- ============================================================
-- 9a. CONTRAINTES D'INTÉGRITÉ
--     La base refuse elle-même les valeurs incohérentes, même si
--     le navigateur est compromis ou si une requête contourne le
--     client. (blocs DO : les tables peuvent déjà exister)
-- ============================================================

-- Annulation douce d'une vente : la ligne est conservée à vie,
-- jamais supprimée, mais exclue des calculs et des écrans.
alter table sales add column if not exists cancelled_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_stock_nonneg') then
    alter table items add constraint items_stock_nonneg check (stock >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'items_opening_stock_nonneg') then
    alter table items add constraint items_opening_stock_nonneg check (opening_stock >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'items_amounts_nonneg') then
    alter table items add constraint items_amounts_nonneg check (cost_price >= 0 and price >= 0 and opening_cost >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restocks_quantity_pos') then
    alter table restocks add constraint restocks_quantity_pos check (quantity > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restocks_unit_cost_nonneg') then
    alter table restocks add constraint restocks_unit_cost_nonneg check (unit_cost >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_quantity_pos') then
    alter table sales add constraint sales_quantity_pos check (quantity > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_amounts_nonneg') then
    alter table sales add constraint sales_amounts_nonneg check (unit_price >= 0 and unit_cost >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'credits_amounts_valid') then
    alter table credits add constraint credits_amounts_valid check (total_amount > 0 and amount_paid >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'credits_paid_within_total') then
    -- tolerance de 0.001 : identique au contrôle client (arrondis FCFA)
    alter table credits add constraint credits_paid_within_total check (amount_paid <= total_amount + 0.001);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'credit_payments_amount_pos') then
    alter table credit_payments add constraint credit_payments_amount_pos check (amount > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'movements_stock_nonneg') then
    alter table stock_movements add constraint movements_stock_nonneg check (stock_before >= 0 and stock_after >= 0);
  end if;
end $$;

-- ============================================================
-- 9b. OPÉRATIONS TRANSACTIONNELLES (RPC)
--     Une seule requête SQL = une opération complète : le stock,
--     la vente, le mouvement et le crédit sont écrits dans la même
--     transaction, avec verrouillage (select ... for update) de la
--     ligne article/crédit. Fini la survente et les mises à jour en
--     plusieurs requêtes séparées.
--     Toutes les fonctions sont security definer avec search_path
--     fixé et CONTRÔLE DE RÔLE explicite (la RLS est contournée).
-- ============================================================

-- Statut d'un crédit, rigoureusement identique à
-- computeCreditStatus() côté client (tolérance 0.001).
create or replace function credit_status(p_total numeric, p_paid numeric, p_due date)
returns text
language sql
stable
as $$
  select case
    when p_paid + 0.001 >= p_total then 'soldé'
    when p_due is not null and p_due < current_date then 'en retard'
    when p_paid > 0 then 'partiellement payé'
    else 'en cours'
  end;
$$;

-- Rejeu complet des événements d'un article (réappro + ventes non
-- annulées) : fonction INTERNE (aucun grant aux utilisateurs) utilisée
-- par les RPC de correction et le contrôle de cohérence.
create or replace function replay_item(p_item_id text)
returns table (stock integer, avg_cost numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty integer;
  v_cost numeric;
  ev record;
begin
  select i.opening_stock, i.opening_cost
    into v_qty, v_cost
    from items i
   where i.id = p_item_id;
  if v_qty is null then
    return;
  end if;

  for ev in
    select 'r'::text as kind,
           r.restock_date::text as d,
           r.created_at,
           r.quantity,
           r.unit_cost
      from restocks r
     where r.item_id = p_item_id
    union all
    select 's'::text,
           s.sale_date::text,
           s.created_at,
           s.quantity,
           null::numeric
      from sales s
     where s.item_id = p_item_id
       and s.cancelled_at is null
     order by d, case when kind = 'r' then 0 else 1 end, created_at
  loop
    if ev.kind = 'r' then
      if v_qty <= 0 then
        v_cost := ev.unit_cost;
      else
        v_cost := (v_qty * v_cost + ev.quantity * ev.unit_cost) / (v_qty + ev.quantity);
      end if;
      v_qty := v_qty + ev.quantity;
    else
      v_qty := greatest(0, v_qty - ev.quantity);
    end if;
  end loop;

  return query select v_qty, v_cost;
end;
$$;

-- ---------------------------------------------------------
-- record_sale : vente atomique (verrou article, contrôle de stock,
-- vente + mouvement + crédit éventuel dans la même transaction)
-- ---------------------------------------------------------
create or replace function record_sale(
  p_sale_id text,
  p_movement_id text,
  p_item_id text,
  p_quantity integer,
  p_payment_type text,
  p_customer_id text default null,
  p_sale_date date default null,
  p_deposit numeric default 0,
  p_due_date date default null,
  p_credit_id text default null,
  p_payment_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item items%rowtype;
  v_role text;
  v_total numeric;
begin
  -- Verrou de la ligne article : deux ventes simultanées s'y enchaînent
  select * into v_item
    from items i
   where i.id = p_item_id and i.deleted_at is null
     for update;
  if not found then
    raise exception 'Article introuvable.';
  end if;

  v_role := my_shop_role(v_item.shop_id);
  if v_role is null then
    raise exception 'Accès refusé à cette boutique.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La quantité vendue doit être supérieure à 0.';
  end if;
  if p_deposit is null or p_deposit < 0 then
    raise exception 'Montant d''acompte invalide.';
  end if;
  if p_payment_type not in ('comptant', 'crédit') then
    raise exception 'Mode de paiement invalide.';
  end if;
  if p_quantity > v_item.stock then
    raise exception 'Stock insuffisant : il ne reste que % « % » (demandé : %).',
      v_item.stock, v_item.name, p_quantity;
  end if;

  v_total := v_item.price * p_quantity;

  if p_payment_type = 'crédit' then
    if not role_at_least(v_role, 'gerant') then
      raise exception 'Seuls les gérants peuvent enregistrer des ventes à crédit.';
    end if;
    if p_customer_id is null or p_customer_id = '' then
      raise exception 'Choisis un client (ou crée-le) pour une vente à crédit.';
    end if;
    if p_deposit > v_total + 0.001 then
      raise exception 'L''acompte ne peut pas dépasser le montant de la vente.';
    end if;
    if p_credit_id is null or p_credit_id = '' then
      raise exception 'Identifiant de crédit manquant.';
    end if;
    if p_deposit > 0 and (p_payment_id is null or p_payment_id = '') then
      raise exception 'Identifiant de paiement manquant.';
    end if;
  end if;

  insert into sales (id, shop_id, item_id, user_id, item_name, quantity,
                     unit_price, unit_cost, payment_type, customer_id, sale_date)
  values (
    p_sale_id, v_item.shop_id, p_item_id, auth.uid(), v_item.name, p_quantity,
    v_item.price, v_item.cost_price, p_payment_type,
    case when p_payment_type = 'crédit' then p_customer_id else null end,
    coalesce(p_sale_date, current_date)
  );

  update items set stock = stock - p_quantity where id = p_item_id;

  insert into stock_movements (id, item_id, shop_id, user_id, type, quantity,
                               stock_before, stock_after, ref_id)
  values (p_movement_id, p_item_id, v_item.shop_id, auth.uid(), 'vente', p_quantity,
          v_item.stock, v_item.stock - p_quantity, p_sale_id);

  if p_payment_type = 'crédit' then
    insert into credits (id, shop_id, customer_id, sale_id, user_id,
                         total_amount, amount_paid, due_date, status, sale_date)
    values (
      p_credit_id, v_item.shop_id, p_customer_id, p_sale_id, auth.uid(),
      v_total, p_deposit, p_due_date,
      credit_status(v_total, p_deposit, p_due_date),
      coalesce(p_sale_date, current_date)
    );
    if p_deposit > 0 then
      insert into credit_payments (id, credit_id, shop_id, user_id, amount, payment_date, note)
      values (p_payment_id, p_credit_id, v_item.shop_id, auth.uid(), p_deposit,
              coalesce(p_sale_date, current_date), 'Acompte à la vente');
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------
-- record_restock : réapprovisionnement atomique (CMM recalculé)
-- ---------------------------------------------------------
create or replace function record_restock(
  p_restock_id text,
  p_movement_id text,
  p_item_id text,
  p_quantity integer,
  p_unit_cost numeric,
  p_restock_date date default null,
  p_supplier text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item items%rowtype;
  v_new_cost numeric;
begin
  select * into v_item
    from items i
   where i.id = p_item_id and i.deleted_at is null
     for update;
  if not found then
    raise exception 'Article introuvable.';
  end if;
  if not role_at_least(my_shop_role(v_item.shop_id), 'gerant') then
    raise exception 'Accès refusé : seuls les gérants peuvent modifier le stock.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La quantité du réapprovisionnement doit être supérieure à 0.';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'Le coût unitaire ne peut pas être négatif.';
  end if;

  -- Coût moyen pondéré, formule identique à l'application :
  -- stock à zéro => le nouveau lot fixe le coût, sinon moyenne pondérée.
  if v_item.stock <= 0 then
    v_new_cost := p_unit_cost;
  else
    v_new_cost := (v_item.stock * v_item.cost_price + p_quantity * p_unit_cost)
                  / (v_item.stock + p_quantity);
  end if;

  insert into restocks (id, item_id, shop_id, user_id, quantity, unit_cost, restock_date, supplier)
  values (p_restock_id, p_item_id, v_item.shop_id, auth.uid(), p_quantity, p_unit_cost,
          coalesce(p_restock_date, current_date), nullif(p_supplier, ''));

  update items
     set stock = stock + p_quantity,
         cost_price = round(v_new_cost, 4)
   where id = p_item_id;

  insert into stock_movements (id, item_id, shop_id, user_id, type, quantity,
                               stock_before, stock_after, ref_id)
  values (p_movement_id, p_item_id, v_item.shop_id, auth.uid(), 'réappro', p_quantity,
          v_item.stock, v_item.stock + p_quantity, p_restock_id);
end;
$$;

-- ---------------------------------------------------------
-- update_restock : correction atomique + recalcul complet du rejeu
-- ---------------------------------------------------------
create or replace function update_restock(
  p_restock_id text,
  p_quantity integer,
  p_unit_cost numeric,
  p_restock_date date,
  p_supplier text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r restocks%rowtype;
  v_state record;
begin
  select * into v_r from restocks r where r.id = p_restock_id for update;
  if not found then
    raise exception 'Réapprovisionnement introuvable.';
  end if;
  if not role_at_least(my_shop_role(v_r.shop_id), 'gerant') then
    raise exception 'Accès refusé : seuls les gérants peuvent modifier le stock.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La quantité du réapprovisionnement doit être supérieure à 0.';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'Le coût unitaire ne peut pas être négatif.';
  end if;

  update restocks
     set quantity = p_quantity,
         unit_cost = p_unit_cost,
         restock_date = coalesce(p_restock_date, restock_date),
         supplier = nullif(p_supplier, '')
   where id = p_restock_id;

  -- Rejeu complet : stock et coût moyen recalculés dans la foulée
  select s.stock, s.avg_cost into v_state from replay_item(v_r.item_id) s;
  update items
     set stock = v_state.stock,
         cost_price = round(v_state.avg_cost, 4)
   where id = v_r.item_id;
end;
$$;

-- ---------------------------------------------------------
-- delete_restock : suppression autorisée aux gérants, atomique
-- ---------------------------------------------------------
create or replace function delete_restock(p_restock_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r restocks%rowtype;
  v_state record;
begin
  select * into v_r from restocks r where r.id = p_restock_id for update;
  if not found then
    raise exception 'Réapprovisionnement introuvable.';
  end if;
  if not role_at_least(my_shop_role(v_r.shop_id), 'gerant') then
    raise exception 'Accès refusé : seuls les gérants peuvent modifier le stock.';
  end if;

  delete from stock_movements where ref_id = p_restock_id and type = 'réappro';
  delete from restocks where id = p_restock_id;

  select s.stock, s.avg_cost into v_state from replay_item(v_r.item_id) s;
  update items
     set stock = v_state.stock,
         cost_price = round(v_state.avg_cost, 4)
   where id = v_r.item_id;
end;
$$;

-- ---------------------------------------------------------
-- record_credit_payment : remboursement atomique
-- ---------------------------------------------------------
create or replace function record_credit_payment(
  p_credit_id text,
  p_payment_id text,
  p_amount numeric,
  p_payment_date date default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c credits%rowtype;
  v_rest numeric;
  v_new numeric;
begin
  select * into v_c from credits c where c.id = p_credit_id for update;
  if not found then
    raise exception 'Crédit introuvable.';
  end if;
  if not role_at_least(my_shop_role(v_c.shop_id), 'gerant') then
    raise exception 'Accès refusé : seuls les gérants gèrent les crédits.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Le montant du remboursement doit être supérieur à 0.';
  end if;

  v_rest := v_c.total_amount - v_c.amount_paid;
  if p_amount > v_rest + 0.001 then
    raise exception 'Le remboursement dépasse le reste à payer (% F).', round(v_rest);
  end if;

  v_new := v_c.amount_paid + p_amount;
  update credits
     set amount_paid = v_new,
         status = credit_status(total_amount, v_new, due_date)
   where id = p_credit_id;

  insert into credit_payments (id, credit_id, shop_id, user_id, amount, payment_date, note)
  values (p_payment_id, p_credit_id, v_c.shop_id, auth.uid(), p_amount,
          coalesce(p_payment_date, current_date), nullif(p_note, ''));
end;
$$;

-- ---------------------------------------------------------
-- cancel_sale : annulation douce — la vente n'est JAMAIS supprimée
-- ---------------------------------------------------------
create or replace function cancel_sale(
  p_sale_id text,
  p_movement_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s sales%rowtype;
  v_c credits%rowtype;
  v_item items%rowtype;
  v_role text;
  v_had_credit boolean := false;
begin
  select * into v_s from sales s where s.id = p_sale_id for update;
  if not found then
    raise exception 'Vente introuvable.';
  end if;
  if v_s.cancelled_at is not null then
    raise exception 'Cette vente est déjà annulée.';
  end if;

  v_role := my_shop_role(v_s.shop_id);
  if v_role is null then
    raise exception 'Accès refusé à cette boutique.';
  end if;
  if v_s.user_id is distinct from auth.uid() and not role_at_least(v_role, 'gerant') then
    raise exception 'Seul un gérant peut annuler la vente d''un autre employé.';
  end if;

  select * into v_c from credits c where c.sale_id = p_sale_id for update;
  v_had_credit := found;
  if v_had_credit and v_c.amount_paid > 0.001 then
    raise exception
      'Impossible d''annuler : ce crédit a déjà reçu % F de remboursements. Rembourse d''abord le client.',
      round(v_c.amount_paid);
  end if;

  -- Retour du stock + mouvement d'annulation (l'écriture d'origine
  -- est conservée : le journal de stock reste une piste complète)
  select * into v_item from items i where i.id = v_s.item_id for update;
  if found then
    update items set stock = stock + v_s.quantity where id = v_s.item_id;
    insert into stock_movements (id, item_id, shop_id, user_id, type, quantity,
                                 stock_before, stock_after, ref_id)
    values (coalesce(p_movement_id, 'mov-' || gen_random_uuid()::text),
            v_s.item_id, v_s.shop_id, auth.uid(), 'annulation', v_s.quantity,
            v_item.stock, v_item.stock + v_s.quantity, v_s.id);
  end if;

  -- Annulation douce : la ligne de vente est conservée à vie
  update sales set cancelled_at = now() where id = p_sale_id;

  -- Crédit NON réglé lié : il n'a jamais existé économiquement
  -- (aucun paiement possible ici, sinon l'annulation est refusée
  -- ci-dessus) — il est retiré pour ne pas fausser les dettes.
  if v_had_credit then
    delete from credit_payments where credit_id = v_c.id;
    delete from credits where id = v_c.id;
  end if;
end;
$$;

-- ---------------------------------------------------------
-- check_stock_consistency : diagnostic
-- Compare le stock affiché au rejeu complet des événements.
-- Renvoie uniquement les articles incohérents (vide = tout est cohérent).
-- ---------------------------------------------------------
create or replace function check_stock_consistency()
returns table (item_id text, shop_id text, item_name text,
               expected_stock integer, actual_stock integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_state record;
begin
  for v_row in
    select i.id, i.shop_id, i.name, i.stock
      from items i
     where i.deleted_at is null
       and my_shop_role(i.shop_id) is not null
  loop
    select s.stock, s.avg_cost into v_state from replay_item(v_row.id) s;
    if v_state.stock is distinct from v_row.stock then
      return query
        select v_row.id, v_row.shop_id, v_row.name, v_state.stock, v_row.stock;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------
-- Droits d'exécution : le rôle anon (sans session) ne peut appeler
-- aucune fonction de données ni d'écriture. Les fonctions restent
-- accessibles à authenticated via le grant PUBLIC par défaut
-- (get_*, compute_avg_cost et period_summary ont déjà un grant
-- explicite vers authenticated plus haut dans ce fichier).
-- ---------------------------------------------------------
revoke execute on function
  get_items(), get_sales(), get_restocks(),
  compute_avg_cost(text), period_summary(date, date),
  record_sale(text, text, text, integer, text, text, date, numeric, date, text, text),
  record_restock(text, text, text, integer, numeric, date, text),
  update_restock(text, integer, numeric, date, text),
  delete_restock(text),
  record_credit_payment(text, text, numeric, date, text),
  cancel_sale(text, text),
  check_stock_consistency(),
  replay_item(text),
  credit_status(numeric, numeric, date)
from anon;

-- Rafraîchissement du cache de schéma PostgREST :
notify pgrst, 'reload schema';
