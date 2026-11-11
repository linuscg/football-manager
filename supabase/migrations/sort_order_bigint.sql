-- sort_order columns receive Date.now() timestamps (collision-safe concurrent
-- adds), which overflow Postgres integer (max ~2.1e9). Widen all to bigint.
alter table accom_stays   alter column sort_order type bigint;
alter table budget_codes  alter column sort_order type bigint;
alter table budget_items  alter column sort_order type bigint;
alter table cast_members  alter column sort_order type bigint;
alter table day_extras    alter column sort_order type bigint;
alter table fulltime_crew alter column sort_order type bigint;
alter table hods          alter column sort_order type bigint;
alter table hotels        alter column sort_order type bigint;
alter table resources     alter column sort_order type bigint;
alter table scenes        alter column sort_order type bigint;
alter table shoot_days    alter column sort_order type bigint;
notify pgrst, 'reload schema';
