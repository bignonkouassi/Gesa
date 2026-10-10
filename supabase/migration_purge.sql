-- ============================================================
-- Gesa — migration PURGE DÉFINITIVE DEPUIS LA CORBEILLE
-- (idempotente, rejouable)
-- La suppression douce reste le geste courant ; la purge retire
-- définitivement la ligne maître. Les cascades FK font le reste :
--   article → réappros + paliers (ventes conservées via item_name)
--   boutique → articles, réappros, clients, membres, journal
--              (ventes et crédits liés en cascade FK)
--   client → ligne seule (ventes et crédits conservés, anonymisés)
-- RLS : purge réservée aux gérants+ (boutique : propriétaire,
-- politique existante). Aucune policy delete sur les tables
-- d'historique (ventes, crédits, remboursements, mouvements).
-- ============================================================

drop policy if exists "membres suppression" on items;
drop policy if exists "membres suppression" on customers;

create policy "membres suppression" on items for delete
  using (role_at_least(my_shop_role(shop_id), 'gerant'));

create policy "membres suppression" on customers for delete
  using (role_at_least(my_shop_role(shop_id), 'gerant'));

-- Rafraîchissement du cache de schéma PostgREST :
notify pgrst, 'reload schema';
