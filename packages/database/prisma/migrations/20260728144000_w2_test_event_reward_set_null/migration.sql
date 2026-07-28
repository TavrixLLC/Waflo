ALTER TABLE "program_test_events" DROP CONSTRAINT IF EXISTS "program_test_events_reward_definition_id_fkey";
ALTER TABLE "program_test_events" ADD CONSTRAINT "program_test_events_reward_definition_id_fkey" FOREIGN KEY ("reward_definition_id") REFERENCES "reward_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
