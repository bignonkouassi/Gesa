-- ============================================================
-- Gesa — migration PRIX PAR PALIERS (idempotente, rejouable)
-- Section 2 + 3 de la spec : colonnes, table price_tiers,
-- trigger de limite, index, RLS, compute_sale_line, record_sale.
-- Les identifiants sont des TEXT (comme le reste du schéma).
-- ============================================================

-- ----------------------------------------------------------
-- 2a. Colonnes sur items et sales
-- ----------------------------------------------------------

alter table items add column if not exists tiered_pricing boolean not null default false;
alter table items add column if not exists tier_mode text not null default 'palier';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_tier_mode_check') then
    alter table items add constraint items_tier_mode_check check (tier_mode in ('palier', 'tranche'));
  end if;
end $$;

alter table sales add column if not exists tier_min_quantity integer;
alter table sales add column if not exists price_overridden boolean not null default false;
alter table sales add column if not exists override_note text;

-- ----------------------------------------------------------
-- 2b. Table price_tiers (les paliers appartiennent à un article)
-- ----------------------------------------------------------

create table if not exists price_tiers (
  id text primary key default ('tier-' || gen_random_uuid()::text),
  item_id text not null references items (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  min_quantity integer not null check (min_quantity >= 2),
  unit_price numeric not null check (unit_price >= 0),
  created_at timestamptz not null default now(),
  unique (item_id, min_quantity)
);

create index if not exists price_tiers_item_qty_idx on price_tiers (item_id, min_quantity);

-- Limite : 10 paliers maximum par article
create or replace function enforce_tier_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from price_tiers where item_id = NEW.item_id and id is distinct from NEW.id) >= 10 then
    raise exception 'Un article peut avoir 10 paliers au maximum.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists price_tiers_limit on price_tiers;
create trigger price_tiers_limit
  before insert or update on price_tiers
  for each row execute function enforce_tier_limit();

-- ----------------------------------------------------------
-- 2c. RLS : lecture pour tout membre (vendeur inclus),
-- écriture réservée aux gérants/propriétaires.
-- ----------------------------------------------------------

alter table price_tiers enable row level security;

-- Rôle sur la boutique d'un article (évite de dupliquer la jointure)
create or replace function item_shop_role(p_item_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select my_shop_role((select i.shop_id from items i where i.id = p_item_id));
$$;

drop policy if exists "membres lecture" on price_tiers;
drop policy if exists "membres insert" on price_tiers;
drop policy if exists "membres maj" on price_tiers;
drop policy if exists "membres suppression" on price_tiers;

create policy "membres lecture" on price_tiers for select
  using (item_shop_role(item_id) is not null);

create policy "membres insert" on price_tiers for insert
  with check (role_at_least(item_shop_role(item_id), 'gerant'));

create policy "membres maj" on price_tiers for update
  using (role_at_least(item_shop_role(item_id), 'gerant'))
  with check (role_at_least(item_shop_role(item_id), 'gerant'));

create policy "membres suppression" on price_tiers for delete
  using (role_at_least(item_shop_role(item_id), 'gerant'));

-- ----------------------------------------------------------
-- 2d. get_items() et grants : les nouvelles colonnes d'articles
-- (l'ordre des colonnes suit la table items pour setof items)
-- ----------------------------------------------------------

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
         i.created_at, i.deleted_at, i.tiered_pricing, i.tier_mode
    from items i
   where my_shop_role(i.shop_id) is not null
   order by i.created_at;
$$;

-- Les vendeurs voient les interrupteurs (pas les coûts, toujours masqués)
grant select (
  id, shop_id, user_id, name, price, stock, low_stock_threshold,
  opening_stock, created_at, deleted_at, tiered_pricing, tier_mode
) on items to authenticated;

-- get_sales() : nouvelles colonnes de traçabilité (ordre = table sales)
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
         s.payment_type, s.customer_id, s.sale_date, s.created_at, s.cancelled_at,
         s.tier_min_quantity, s.price_overridden, s.override_note
    from sales s
   where my_shop_role(s.shop_id) is not null
     and s.cancelled_at is null
    order by s.sale_date desc, s.created_at desc;
$$;

-- ----------------------------------------------------------
-- 3. Calcul du prix côté serveur (jamais le navigateur)
-- ----------------------------------------------------------

-- Palier : toutes les unités au prix du meilleur palier atteint.
-- Tranche : unités sous le 1er seuil au prix normal, puis chaque
-- tranche à son prix. unit_price = total ÷ quantité, arrondi au franc.
create or replace function compute_sale_line(p_item_id text, p_qty integer)
returns table (unit_price numeric, line_total numeric, tier_min_quantity integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_price numeric;
  v_tiered boolean;
  v_mode text;
  r record;
  v_best_min integer := null;
  v_best_price numeric := null;
  v_total numeric := 0;
  v_bound integer := 1;
  v_prev_price numeric;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'La quantité vendue doit être supérieure à 0.';
  end if;

  select i.price, i.tiered_pricing, i.tier_mode
    into v_price, v_tiered, v_mode
    from items i
   where i.id = p_item_id;
  if not found then
    raise exception 'Article introuvable.';
  end if;

  -- Option éteinte ou aucun palier : prix normal
  if not coalesce(v_tiered, false) then
    return query select v_price, v_price * p_qty, null::integer;
    return;
  end if;

  select t.min_quantity, t.unit_price
    into v_best_min, v_best_price
    from price_tiers t
   where t.item_id = p_item_id
     and t.min_quantity <= p_qty
   order by t.min_quantity desc
   limit 1;

  if v_best_min is null then
    return query select v_price, v_price * p_qty, null::integer;
    return;
  end if;

  if coalesce(v_mode, 'palier') = 'tranche' then
    v_prev_price := v_price;
    for r in
      select t.min_quantity, t.unit_price
        from price_tiers t
       where t.item_id = p_item_id
         and t.min_quantity <= p_qty
       order by t.min_quantity
    loop
      v_total := v_total + (r.min_quantity - v_bound) * v_prev_price;
      v_bound := r.min_quantity;
      v_prev_price := r.unit_price;
    end loop;
    v_total := v_total + (p_qty - v_bound + 1) * v_prev_price;
    return query select round(v_total / p_qty)::numeric, v_total, v_best_min;
  else
    return query select v_best_price, v_best_price * p_qty, v_best_min;
  end if;
end;
$$;

-- ----------------------------------------------------------
-- record_sale : vente atomique, prix relu en base.
-- Nouveaux paramètres (optionnels, appels existants inchangés) :
-- p_override_price / p_override_note (gérant+, note obligatoire),
-- et idempotence : un même p_sale_id renvoyé ne crée rien.
-- ----------------------------------------------------------

drop function if exists record_sale(text, text, text, integer, text, text, date, numeric, date, text, text);

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
  p_payment_id text default null,
  p_override_price numeric default null,
  p_override_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item items%rowtype;
  v_role text;
  v_line record;
  v_unit numeric;
  v_total numeric;
  v_tier integer := null;
  v_over boolean := false;
  v_note text := null;
begin
  -- Idempotence : rejouer la même vente ne crée aucun doublon
  if exists (select 1 from sales s where s.id = p_sale_id) then
    return;
  end if;

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

  -- Prix relu en base : le navigateur ne l'envoie jamais
  select * into v_line from compute_sale_line(p_item_id, p_quantity);
  v_unit := v_line.unit_price;
  v_total := v_line.line_total;
  v_tier := v_line.tier_min_quantity;

  -- Prix modifié à la main : gérant+, note obligatoire
  if p_override_price is not null then
    if not role_at_least(v_role, 'gerant') then
      raise exception 'Seuls les gérants peuvent modifier le prix.';
    end if;
    if p_override_note is null or btrim(p_override_note) = '' then
      raise exception 'Une note est obligatoire pour un prix modifié.';
    end if;
    if p_override_price < 0 then
      raise exception 'Le prix modifié ne peut pas être négatif.';
    end if;
    v_unit := p_override_price;
    v_total := p_override_price * p_quantity;
    v_tier := null;
    v_over := true;
    v_note := btrim(p_override_note);
  end if;

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
                     unit_price, unit_cost, payment_type, customer_id, sale_date,
                     tier_min_quantity, price_overridden, override_note)
  values (
    p_sale_id, v_item.shop_id, p_item_id, auth.uid(), v_item.name, p_quantity,
    v_unit, v_item.cost_price, p_payment_type,
    case when p_payment_type = 'crédit' then p_customer_id else null end,
    coalesce(p_sale_date, current_date),
    v_tier, v_over, v_note
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

-- ----------------------------------------------------------
-- Droits : les nouvelles fonctions restent inaccessibles à anon
-- ----------------------------------------------------------

revoke execute on function
  item_shop_role(text),
  compute_sale_line(text, integer),
  record_sale(text, text, text, integer, text, text, date, numeric, date, text, text, numeric, text),
  enforce_tier_limit()
from anon;

grant execute on function
  item_shop_role(text),
  compute_sale_line(text, integer)
to authenticated;

-- Rafraîchissement du cache de schéma PostgREST :
notify pgrst, 'reload schema';
