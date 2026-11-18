-- Keep operational scrapes cheap as sent/done rows accumulate.
CREATE INDEX bot_inbox_failed_metrics ON bot_inbox(update_id) WHERE state='failed';
CREATE INDEX bot_outbox_failed_metrics ON bot_outbox(id) WHERE state='failed';
