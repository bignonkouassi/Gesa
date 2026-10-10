-- ============================================================
-- Gesa — ROLLBACK de la migration MODE DE VENTE
-- Restaure record_sale / get_sales à la version précédente puis
-- retire la colonne sales.sale_mode. Aucun prix ni stock modifié
-- par la migration n'est altéré (seule sale_mode disparaît).
-- ============================================================

drop function if exists record_sale(text, text, text, integer, text, text, date, numeric, date, text, text, numeric, text, text);

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

revoke execute on function
  record_sale(text, text, text, integer, text, text, date, numeric, date, text, text, numeric, text)
from anon;

alter table sales drop constraint if exists sales_sale_mode_check;
alter table sales drop column if exists sale_mode;

-- Rafraîchissement du cache de schéma PostgREST :
notify pgrst, 'reload schema';
