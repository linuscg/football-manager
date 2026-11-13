-- Automatic Delivered dots: store each send's Resend email id so the
-- resend-webhook function can flip email_delivered / memo_delivered when
-- Resend reports actual delivery.
alter table new_starter_status add column if not exists welcome_email_id text;
alter table new_starter_status add column if not exists memo_email_id text;
notify pgrst, 'reload schema';
