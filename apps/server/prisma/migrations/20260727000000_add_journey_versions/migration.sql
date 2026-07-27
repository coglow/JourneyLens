-- CreateTable
CREATE TABLE "journey_versions" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "source_revision" INTEGER NOT NULL,
    "source_segment_revision" INTEGER,
    "snapshot" JSONB NOT NULL,
    "published_by" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "journey_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "journey_versions_version_number_positive_check" CHECK ("version_number" >= 1),
    CONSTRAINT "journey_versions_source_revision_positive_check" CHECK ("source_revision" >= 1),
    CONSTRAINT "journey_versions_source_segment_revision_positive_check" CHECK ("source_segment_revision" IS NULL OR "source_segment_revision" >= 1),
    CONSTRAINT "journey_versions_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journey_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "operator_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "journey_versions_journey_id_version_number_key" ON "journey_versions"("journey_id", "version_number");

CREATE OR REPLACE FUNCTION public.journey_versions_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'journey_versions 只允许追加，不可修改或删除';
END;
$function$;

CREATE TRIGGER journey_versions_immutable_trigger BEFORE DELETE OR UPDATE ON public.journey_versions FOR EACH ROW EXECUTE FUNCTION journey_versions_immutable();
