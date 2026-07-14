-- TCGA analytics schema (curated, agent-facing slice).
-- Column comments double as the text-to-SQL model's glossary.
CREATE DATABASE IF NOT EXISTS tcga;

CREATE TABLE IF NOT EXISTS tcga.clinical
(
    case_id                String  COMMENT 'GDC case UUID',
    submitter_id           String  COMMENT 'TCGA patient barcode, e.g. TCGA-XX-XXXX',
    project_id             LowCardinality(String) COMMENT 'TCGA project, e.g. TCGA-PAAD (pancreatic), TCGA-BRCA (breast)',
    primary_site           LowCardinality(String) COMMENT 'Anatomical site of the tumor',
    disease_type           LowCardinality(String) COMMENT 'Disease classification',
    primary_diagnosis      String  COMMENT 'Morphological diagnosis',
    age_at_diagnosis_days  Nullable(Int32) COMMENT 'Age at diagnosis in DAYS (divide by 365.25 for years)',
    gender                 LowCardinality(String),
    race                   LowCardinality(String),
    ethnicity              LowCardinality(String),
    vital_status           LowCardinality(String) COMMENT 'Alive / Dead',
    days_to_death          Nullable(Int32) COMMENT 'Days from diagnosis to death; NULL if alive',
    days_to_last_follow_up Nullable(Int32),
    ajcc_pathologic_stage  LowCardinality(String) COMMENT 'Tumor stage, e.g. Stage I..IV',
    ingested_at            DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY (project_id, case_id);

CREATE TABLE IF NOT EXISTS tcga.mutations
(
    project_id             LowCardinality(String) COMMENT 'TCGA project the variant belongs to',
    hugo_symbol            String  COMMENT 'Gene name, e.g. KRAS, TP53, BRCA1',
    entrez_gene_id         Nullable(Int64),
    chromosome             LowCardinality(String),
    start_position         Nullable(Int64),
    end_position           Nullable(Int64),
    variant_classification LowCardinality(String) COMMENT 'e.g. Missense_Mutation, Nonsense_Mutation, Silent',
    variant_type           LowCardinality(String) COMMENT 'SNP, INS, DEL',
    reference_allele       String,
    tumor_seq_allele2      String  COMMENT 'Observed tumor allele',
    dbsnp_rs               String,
    tumor_sample_barcode   String  COMMENT 'TCGA aliquot barcode; first 12 chars = patient barcode',
    hgvsp_short            String  COMMENT 'Protein change, e.g. p.G12D',
    consequence            String,
    impact                 LowCardinality(String) COMMENT 'VEP impact: HIGH, MODERATE, LOW, MODIFIER',
    t_depth                Nullable(Int32) COMMENT 'Read depth at this locus in the tumor',
    t_alt_count            Nullable(Int32) COMMENT 'Reads supporting the variant allele',
    patient_barcode        String  COMMENT 'TCGA-XX-XXXX derived from tumor_sample_barcode',
    ingested_at            DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY (project_id, hugo_symbol, patient_barcode);

CREATE VIEW IF NOT EXISTS tcga.gene_mutation_counts AS
SELECT project_id, hugo_symbol, count() AS n_mutations, uniqExact(patient_barcode) AS n_patients
FROM tcga.mutations GROUP BY project_id, hugo_symbol;
