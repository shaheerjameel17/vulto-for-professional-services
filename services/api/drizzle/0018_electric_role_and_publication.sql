-- Electric's database access (A003-T52, A003-T58, F201/F202).
--
-- The replication service reads Postgres and never writes it, and it may see
-- exactly the four tables a device's two shapes are built from. The role has no
-- password here: `scripts/set-electric-password.mjs` sets it from
-- ELECTRIC_DB_PASSWORD after migration, so no secret lives in a migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vulto_electric') THEN
    CREATE ROLE vulto_electric WITH LOGIN REPLICATION;
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM vulto_electric;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO vulto_electric;--> statement-breakpoint
GRANT SELECT ON graph_nodes, graph_edges, sync_node_audience, sync_edge_audience TO vulto_electric;--> statement-breakpoint
-- Electric needs whole old rows to stream updates and deletes of a filtered shape.
ALTER TABLE graph_nodes REPLICA IDENTITY FULL;--> statement-breakpoint
ALTER TABLE graph_edges REPLICA IDENTITY FULL;--> statement-breakpoint
ALTER TABLE sync_node_audience REPLICA IDENTITY FULL;--> statement-breakpoint
ALTER TABLE sync_edge_audience REPLICA IDENTITY FULL;--> statement-breakpoint
-- The publication is an allowlist (A003-T58): exactly these four tables.
DROP PUBLICATION IF EXISTS electric_publication_default;--> statement-breakpoint
CREATE PUBLICATION electric_publication_default
  FOR TABLE graph_nodes, graph_edges, sync_node_audience, sync_edge_audience;
