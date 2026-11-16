-- Transport log: free-text notes per trip.
alter table transport_log add column if not exists notes text not null default '';
notify pgrst, 'reload schema';
