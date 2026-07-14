"""
Ingest a tractable slice of TCGA into ClickHouse via the GDC public API
(open-access only, no AWS credentials). Same files also live in s3://tcga-2-open.
"""
from __future__ import annotations
import gzip, io, os, sys, time
from typing import Any, Iterable
import requests, clickhouse_connect

GDC_API = "https://api.gdc.cancer.gov"
PROJECTS = [p.strip() for p in os.getenv("TCGA_PROJECTS", "TCGA-PAAD").split(",") if p.strip()]
MAX_MAF_FILES = int(os.getenv("TCGA_MAX_MAF_FILES", "3"))
MAX_CASES = int(os.getenv("TCGA_MAX_CASES", "1000"))
CH_HOST = os.getenv("CLICKHOUSE_HOST", "clickhouse")
CH_PORT = int(os.getenv("CLICKHOUSE_PORT", "8123"))
CH_USER = os.getenv("CLICKHOUSE_USER", "default")
CH_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "")

def log(m): print(f"[ingest] {m}", flush=True)

def wait_for_clickhouse(client, retries=30):
    for i in range(retries):
        try:
            client.query("SELECT 1"); return
        except Exception as exc:
            log(f"waiting for ClickHouse ({i+1}/{retries}): {exc}"); time.sleep(2)
    raise SystemExit("ClickHouse never became ready")

CLINICAL_FIELDS = ["case_id","submitter_id","project.project_id","primary_site",
    "disease_type","diagnoses.primary_diagnosis","diagnoses.age_at_diagnosis",
    "diagnoses.ajcc_pathologic_stage","diagnoses.days_to_death",
    "diagnoses.days_to_last_follow_up","diagnoses.vital_status",
    "demographic.gender","demographic.race","demographic.ethnicity",
    "demographic.vital_status","demographic.days_to_death"]
CLINICAL_COLS = ["case_id","submitter_id","project_id","primary_site","disease_type",
    "primary_diagnosis","age_at_diagnosis_days","gender","race","ethnicity",
    "vital_status","days_to_death","days_to_last_follow_up","ajcc_pathologic_stage"]

def _first(seq, key):
    if isinstance(seq, list):
        for it in seq:
            if isinstance(it, dict) and it.get(key) not in (None, ""):
                return it.get(key)
        return None
    if isinstance(seq, dict): return seq.get(key)
    return None

def _int(v):
    try: return int(v) if v not in (None, "", ".") else None
    except (TypeError, ValueError): return None

def fetch_clinical(project):
    rows, page, frm = [], 200, 0
    while len(rows) < MAX_CASES:
        payload = {"filters":{"op":"in","content":{"field":"project.project_id","value":[project]}},
                   "fields":",".join(CLINICAL_FIELDS),"format":"JSON","size":page,"from":frm}
        r = requests.post(f"{GDC_API}/cases", json=payload, timeout=60); r.raise_for_status()
        hits = r.json().get("data", {}).get("hits", [])
        if not hits: break
        for h in hits:
            dg, dm = h.get("diagnoses", []), h.get("demographic", {})
            vital = _first(dg,"vital_status") or (dm.get("vital_status") if isinstance(dm,dict) else None)
            d2d = _first(dg,"days_to_death")
            if d2d is None and isinstance(dm,dict): d2d = dm.get("days_to_death")
            rows.append([h.get("case_id",""), h.get("submitter_id",""),
                (h.get("project") or {}).get("project_id", project),
                h.get("primary_site","") or "", h.get("disease_type","") or "",
                _first(dg,"primary_diagnosis") or "", _int(_first(dg,"age_at_diagnosis")),
                (dm.get("gender") if isinstance(dm,dict) else "") or "",
                (dm.get("race") if isinstance(dm,dict) else "") or "",
                (dm.get("ethnicity") if isinstance(dm,dict) else "") or "",
                vital or "", _int(d2d), _int(_first(dg,"days_to_last_follow_up")),
                _first(dg,"ajcc_pathologic_stage") or ""])
        frm += page
        if len(hits) < page: break
    return rows[:MAX_CASES]

MAF_MAP = {"Hugo_Symbol":"hugo_symbol","Entrez_Gene_Id":"entrez_gene_id",
    "Chromosome":"chromosome","Start_Position":"start_position","End_Position":"end_position",
    "Variant_Classification":"variant_classification","Variant_Type":"variant_type",
    "Reference_Allele":"reference_allele","Tumor_Seq_Allele2":"tumor_seq_allele2",
    "dbSNP_RS":"dbsnp_rs","Tumor_Sample_Barcode":"tumor_sample_barcode",
    "HGVSp_Short":"hgvsp_short","Consequence":"consequence","IMPACT":"impact",
    "t_depth":"t_depth","t_alt_count":"t_alt_count"}
MUT_COLS = ["project_id","hugo_symbol","entrez_gene_id","chromosome","start_position",
    "end_position","variant_classification","variant_type","reference_allele",
    "tumor_seq_allele2","dbsnp_rs","tumor_sample_barcode","hgvsp_short","consequence",
    "impact","t_depth","t_alt_count","patient_barcode"]
_INT_COLS = {"entrez_gene_id","start_position","end_position","t_depth","t_alt_count"}

def find_maf_files(project):
    payload = {"filters":{"op":"and","content":[
        {"op":"in","content":{"field":"cases.project.project_id","value":[project]}},
        {"op":"in","content":{"field":"data_type","value":["Masked Somatic Mutation"]}},
        {"op":"in","content":{"field":"data_format","value":["MAF"]}},
        {"op":"in","content":{"field":"access","value":["open"]}}]},
        "fields":"file_id,file_name","format":"JSON","size":MAX_MAF_FILES}
    r = requests.post(f"{GDC_API}/files", json=payload, timeout=60); r.raise_for_status()
    return r.json().get("data", {}).get("hits", [])

def download_and_parse_maf(file_id, project):
    r = requests.get(f"{GDC_API}/data/{file_id}", timeout=300); r.raise_for_status()
    raw = r.content
    try: text = gzip.GzipFile(fileobj=io.BytesIO(raw)).read().decode("utf-8","replace")
    except OSError: text = raw.decode("utf-8","replace")
    header, idx = None, {}
    for line in text.splitlines():
        if not line or line.startswith("#"): continue
        parts = line.split("\t")
        if header is None:
            header = parts; idx = {c: header.index(c) for c in MAF_MAP if c in header}; continue
        row = {}
        for mc, oc in MAF_MAP.items():
            val = parts[idx[mc]] if mc in idx and idx[mc] < len(parts) else ""
            row[oc] = _int(val) if oc in _INT_COLS else (val or "")
        bc = row.get("tumor_sample_barcode","") or ""
        patient = "-".join(bc.split("-")[:3]) if bc else ""
        yield [project, row.get("hugo_symbol",""), row.get("entrez_gene_id"),
            row.get("chromosome",""), row.get("start_position"), row.get("end_position"),
            row.get("variant_classification",""), row.get("variant_type",""),
            row.get("reference_allele",""), row.get("tumor_seq_allele2",""),
            row.get("dbsnp_rs",""), bc, row.get("hgvsp_short",""), row.get("consequence",""),
            row.get("impact",""), row.get("t_depth"), row.get("t_alt_count"), patient]

def main():
    client = clickhouse_connect.get_client(host=CH_HOST, port=CH_PORT, username=CH_USER, password=CH_PASSWORD)
    wait_for_clickhouse(client)
    log(f"connected to ClickHouse at {CH_HOST}:{CH_PORT}")
    already = client.query("SELECT count() FROM tcga.clinical").result_rows[0][0]
    if already and os.getenv("TCGA_FORCE_REINGEST","false").lower() != "true":
        log(f"tcga.clinical already has {already} rows; skipping (set TCGA_FORCE_REINGEST=true)"); return
    for project in PROJECTS:
        log(f"=== {project} ===")
        clinical = fetch_clinical(project)
        if clinical: client.insert("tcga.clinical", clinical, column_names=CLINICAL_COLS)
        log(f"inserted {len(clinical)} clinical rows")
        files = find_maf_files(project); log(f"found {len(files)} MAF file(s)")
        total = 0
        for f in files:
            fid, fname = f["file_id"], f.get("file_name", f["file_id"])
            log(f"  downloading {fname} ...")
            batch = list(download_and_parse_maf(fid, project))
            if batch: client.insert("tcga.mutations", batch, column_names=MUT_COLS); total += len(batch)
            log(f"  inserted {len(batch)} variant rows")
        log(f"{project}: {total} mutation rows total")
    log("done.")

if __name__ == "__main__":
    try: main()
    except Exception as exc:
        log(f"FATAL: {exc}"); sys.exit(1)
