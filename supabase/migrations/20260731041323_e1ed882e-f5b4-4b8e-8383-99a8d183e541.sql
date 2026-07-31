REVOKE EXECUTE ON FUNCTION public.apply_square_payment(uuid, text, integer, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_square_payment(uuid, text, integer, text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_square_payment(uuid, text, integer, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_square_payment(uuid, text, integer, text, boolean) TO service_role;