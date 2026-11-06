ALTER TABLE "survey_responses" DROP CONSTRAINT "survey_responses_employee_id_organization_id_fkey";
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "suggestions" DROP CONSTRAINT "suggestions_employee_id_organization_id_fkey";
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_employee_id_organization_id_fkey" FOREIGN KEY ("employee_id", "organization_id") REFERENCES "employees"("id", "organization_id") ON DELETE SET NULL ON UPDATE CASCADE;
