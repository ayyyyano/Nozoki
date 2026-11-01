-- Quote selections participate in the source revision checked by the final collection transaction.
CREATE TRIGGER collection_quotes_inserted AFTER INSERT ON quote_symbols WHEN NEW.enabled=1
BEGIN UPDATE integrations SET collection_revision=collection_revision+1 WHERE id=NEW.provider AND provider='quotes-custom'; END;
CREATE TRIGGER collection_quotes_deleted AFTER DELETE ON quote_symbols WHEN OLD.enabled=1
BEGIN UPDATE integrations SET collection_revision=collection_revision+1 WHERE id=OLD.provider AND provider='quotes-custom'; END;
CREATE TRIGGER collection_quotes_changed AFTER UPDATE ON quote_symbols
WHEN NEW.market IS NOT OLD.market OR NEW.symbol IS NOT OLD.symbol OR NEW.provider IS NOT OLD.provider
 OR NEW.enabled IS NOT OLD.enabled OR NEW.display_name IS NOT OLD.display_name
 OR NEW.sort_order IS NOT OLD.sort_order OR NEW.refresh_interval IS NOT OLD.refresh_interval
BEGIN UPDATE integrations SET collection_revision=collection_revision+1 WHERE provider='quotes-custom'
 AND id IN (SELECT OLD.provider WHERE OLD.enabled=1 UNION SELECT NEW.provider WHERE NEW.enabled=1); END;
