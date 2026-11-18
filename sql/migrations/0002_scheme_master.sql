-- AMFI's scheme master (https://portal.amfiindia.com/DownloadSchemeData_Po.aspx?mf=0): the name of
-- every plan and option of every scheme ("Scheme NAV Name"). AMFI's daily NAV file, which mfapi
-- serves, sometimes names a plan by the fund alone or gives two plans one name; scheme_info falls
-- back to this name there. Re-ingesting replaces the row (latest updated_at wins).
CREATE TABLE IF NOT EXISTS scheme_master
(
    scheme_code UInt32,
    nav_name    String,
    updated_at  DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY scheme_code;
