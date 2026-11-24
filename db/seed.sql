INSERT INTO public.simple_price_list(amount,visits,flag_for_review) VALUES (375,8,false),(345,8,false),(200,4,false),(100,2,true),(50,1,true) ON CONFLICT(amount) DO NOTHING;
INSERT INTO public.simple_dues_settings(id,cutover_date) VALUES(true,NULL) ON CONFLICT(id) DO NOTHING;
