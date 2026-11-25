-- J3(pg_cron の接地)テスト用の固定 fixture。本物の migration とは無関係。
select cron.schedule(
  'run_due_jobs',
  '*/10 * * * *',
  $cron$ select net.http_get(url := 'https://example.com/api/jobs/run'); $cron$
);
