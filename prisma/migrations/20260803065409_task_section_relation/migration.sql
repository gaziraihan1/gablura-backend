-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ProjectSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
