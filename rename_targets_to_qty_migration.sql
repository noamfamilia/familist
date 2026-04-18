-- Rename existing "Targets" members to "Qty"
UPDATE public.members SET name = 'Qty' WHERE is_target = true AND name = 'Targets';
