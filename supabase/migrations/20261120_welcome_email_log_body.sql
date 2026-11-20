-- Email history keeps exactly what was sent (body + attachment filenames) so a
-- row can be previewed. Attachment CONTENTS are never stored (deal memo PDFs
-- carry rates). Older rows are back-filled on first view from Resend.
alter table welcome_email_log add column if not exists html text;
alter table welcome_email_log add column if not exists body_text text;
alter table welcome_email_log add column if not exists attachment_names jsonb not null default '[]'::jsonb;
notify pgrst, 'reload schema';
