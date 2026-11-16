-- Cast numbers become free text ("1st", "6bd", "1os"…) instead of integers.
alter table cast_members alter column cast_number type text using cast_number::text;
notify pgrst, 'reload schema';
