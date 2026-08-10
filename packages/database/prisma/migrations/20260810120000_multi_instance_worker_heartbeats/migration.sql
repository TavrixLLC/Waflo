-- Worker health is recorded per process so multiple worker replicas cannot
-- overwrite one another's readiness and graceful-shutdown state.
ALTER TABLE "worker_heartbeats"
DROP CONSTRAINT "worker_heartbeats_pkey";

ALTER TABLE "worker_heartbeats"
ADD CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("worker_code", "instance_id");

CREATE INDEX "worker_heartbeats_worker_code_last_loop_at_idx"
ON "worker_heartbeats"("worker_code", "last_loop_at");
